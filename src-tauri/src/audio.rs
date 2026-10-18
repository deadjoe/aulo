//! Built-in audio conversion for downloads: FLAC decoding, WAV and MP3 encoding.
//! Nothing here depends on the music engine, Python, or tools on the computer.
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

/// Decoded audio, interleaved, as floats in -1.0..=1.0.
pub struct Pcm {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
}

impl Pcm {
    #[cfg(test)]
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels.max(1) as usize
    }
}

pub fn decode_flac(path: &Path) -> Result<Pcm, String> {
    let mut reader = claxon::FlacReader::open(path).map_err(|e| e.to_string())?;
    let info = reader.streaminfo();
    if info.channels == 0 || info.channels > 2 || info.sample_rate == 0 {
        return Err("unsupported audio layout".into());
    }
    let scale = (1u64 << (info.bits_per_sample - 1)) as f32;
    let mut samples =
        Vec::with_capacity(info.samples.unwrap_or(0) as usize * info.channels as usize);
    for sample in reader.samples() {
        samples.push(sample.map_err(|e| e.to_string())? as f32 / scale);
    }
    Ok(Pcm {
        sample_rate: info.sample_rate,
        channels: info.channels as u16,
        samples,
    })
}

/// A finished FLAC's length in seconds, from its header; None unless it is playable.
pub fn flac_duration(path: &Path) -> Option<f64> {
    let reader = claxon::FlacReader::open(path).ok()?;
    let info = reader.streaminfo();
    let frames = info.samples.filter(|&n| n > 0)?;
    (info.sample_rate > 0).then(|| frames as f64 / info.sample_rate as f64)
}

/// How many bars a waveform has; the interface scales them to its width.
pub const WAVEFORM_BARS: usize = 160;
/// Frames summarised by one block while reading; a 4-minute song is about 11,000 blocks.
const BLOCK_FRAMES: usize = 1024;

/// Peak levels gathered while samples stream past, so a song is never held in memory.
struct PeakMeter {
    block_samples: usize,
    seen: usize,
    current: f32,
    blocks: Vec<f32>,
}

impl PeakMeter {
    fn new(channels: usize) -> Self {
        Self {
            block_samples: BLOCK_FRAMES * channels.max(1),
            seen: 0,
            current: 0.0,
            blocks: Vec::new(),
        }
    }

    fn push(&mut self, sample: f32) {
        self.current = self.current.max(sample.abs());
        self.seen += 1;
        if self.seen == self.block_samples {
            self.blocks.push(self.current);
            self.seen = 0;
            self.current = 0.0;
        }
    }

    /// Peak level per slice of the song, scaled so the loudest slice is 1.0.
    fn finish(mut self) -> Vec<f32> {
        if self.seen > 0 {
            self.blocks.push(self.current);
        }
        let count = self.blocks.len();
        let mut peaks = vec![0f32; WAVEFORM_BARS];
        if count > 0 {
            for (bar, peak) in peaks.iter_mut().enumerate() {
                let start = bar * count / WAVEFORM_BARS;
                let end = ((bar + 1) * count / WAVEFORM_BARS).max(start + 1);
                *peak = self.blocks[start..end].iter().copied().fold(0f32, f32::max);
            }
        }
        let loudest = peaks.iter().copied().fold(0f32, f32::max);
        if loudest > 0.0 {
            for peak in &mut peaks {
                *peak = (*peak / loudest * 1000.0).round() / 1000.0;
            }
        }
        peaks
    }
}

#[cfg(test)]
pub fn waveform(pcm: &Pcm) -> Vec<f32> {
    let mut meter = PeakMeter::new(pcm.channels as usize);
    pcm.samples.iter().for_each(|&s| meter.push(s));
    meter.finish()
}

/// A song's waveform, read straight from its FLAC file.
pub fn waveform_of(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = claxon::FlacReader::open(path).map_err(|e| e.to_string())?;
    let info = reader.streaminfo();
    if info.channels == 0 || info.channels > 2 || info.sample_rate == 0 {
        return Err("unsupported audio layout".into());
    }
    let scale = (1u64 << (info.bits_per_sample - 1)) as f32;
    let mut meter = PeakMeter::new(info.channels as usize);
    for sample in reader.samples() {
        meter.push(sample.map_err(|e| e.to_string())? as f32 / scale);
    }
    Ok(meter.finish())
}

/// What a saved or shared song file carries besides its audio.
#[derive(Clone, Debug, Default)]
pub struct Tags {
    pub title: String,
    /// The song's cover as PNG.
    pub cover: Option<Vec<u8>>,
}

/// Covers come from the interface; only a real PNG of a sensible size is written.
pub fn valid_cover(bytes: &[u8]) -> bool {
    bytes.len() <= 4 * 1024 * 1024 && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
}

/// Write the title and cover into an MP3, M4A or FLAC file, as music apps and
/// phones expect them.
pub fn write_tags(path: &Path, tags: &Tags) -> Result<(), String> {
    // A tagging library must never take the app down over an unusual file.
    std::panic::catch_unwind(|| tag_file(path, tags))
        .unwrap_or_else(|_| Err("the file could not be tagged".into()))
}

fn tag_file(path: &Path, tags: &Tags) -> Result<(), String> {
    use lofty::{
        config::WriteOptions,
        picture::{MimeType, Picture, PictureType},
        prelude::*,
        tag::Tag,
    };
    let mut file = lofty::read_from_path(path).map_err(|e| e.to_string())?;
    let kind = file.primary_tag_type();
    if file.primary_tag_mut().is_none() {
        file.insert_tag(Tag::new(kind));
    }
    let tag = file.primary_tag_mut().ok_or("no tag")?;
    if !tags.title.trim().is_empty() {
        tag.set_title(tags.title.trim().to_string());
    }
    if let Some(png) = tags.cover.as_ref().filter(|png| valid_cover(png)) {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(
            Picture::unchecked(png.clone())
                .pic_type(PictureType::CoverFront)
                .mime_type(MimeType::Png)
                .build(),
        );
    }
    file.save_to_path(path, WriteOptions::default())
        .map_err(|e| e.to_string())
}

/// 24-bit PCM WAV keeps the model's output precision for editing.
pub fn write_wav(pcm: &Pcm, path: &Path) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: pcm.channels,
        sample_rate: pcm.sample_rate,
        bits_per_sample: 24,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    const MAX: f32 = 8_388_607.0;
    for &sample in &pcm.samples {
        let value = (sample.clamp(-1.0, 1.0) * MAX).round() as i32;
        writer.write_sample(value).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())
}

/// 320 kbps constant bit rate with LAME's recommended high-quality setting (-q 2).
pub fn write_mp3(pcm: &Pcm, path: &Path) -> Result<(), String> {
    use mp3lame_encoder::{Bitrate, Builder, FlushNoGap, InterleavedPcm, MonoPcm, Quality};
    let mut encoder = Builder::new()
        .ok_or("encoder unavailable")?
        .with_num_channels(pcm.channels as u8)
        .and_then(|b| b.with_sample_rate(pcm.sample_rate))
        .and_then(|b| b.with_brate(Bitrate::Kbps320))
        .and_then(|b| b.with_quality(Quality::NearBest))
        .and_then(|b| b.build())
        .map_err(|e| format!("{e:?}"))?;
    let mut out = BufWriter::new(File::create(path).map_err(|e| e.to_string())?);
    let mut buffer = Vec::new();
    const CHUNK_FRAMES: usize = 4608;
    let step = CHUNK_FRAMES * pcm.channels as usize;
    for chunk in pcm.samples.chunks(step) {
        buffer.clear();
        let frames = chunk.len() / pcm.channels as usize;
        buffer.reserve(mp3lame_encoder::max_required_buffer_size(frames));
        if pcm.channels == 2 {
            encoder.encode_to_vec(InterleavedPcm(chunk), &mut buffer)
        } else {
            encoder.encode_to_vec(MonoPcm(chunk), &mut buffer)
        }
        .map_err(|e| format!("{e:?}"))?;
        out.write_all(&buffer).map_err(|e| e.to_string())?;
    }
    buffer.clear();
    buffer.reserve(mp3lame_encoder::max_required_buffer_size(CHUNK_FRAMES));
    encoder
        .flush_to_vec::<FlushNoGap>(&mut buffer)
        .map_err(|e| format!("{e:?}"))?;
    out.write_all(&buffer).map_err(|e| e.to_string())?;
    out.flush().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, seconds: f32) -> Pcm {
        let frames = (rate as f32 * seconds) as usize;
        let mut samples = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let v = (i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 0.5;
            samples.extend([v, -v]);
        }
        Pcm {
            sample_rate: rate,
            channels: 2,
            samples,
        }
    }

    #[test]
    fn wav_round_trips_at_24_bit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.wav");
        let pcm = tone(48_000, 0.5);
        write_wav(&pcm, &path).unwrap();
        let reader = hound::WavReader::open(&path).unwrap();
        let spec = reader.spec();
        assert_eq!(
            (spec.channels, spec.sample_rate, spec.bits_per_sample),
            (2, 48_000, 24)
        );
        assert_eq!(reader.duration() as usize, pcm.frames());
        let first: Vec<i32> = reader
            .into_samples::<i32>()
            .take(4)
            .map(Result::unwrap)
            .collect();
        assert_eq!(first[0], 0);
        assert!((first[2] as f32 / 8_388_607.0 - pcm.samples[2]).abs() < 1e-6);
    }

    #[test]
    fn mp3_is_320_kbps_mpeg_audio_of_the_right_length() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.mp3");
        write_mp3(&tone(48_000, 2.0), &path).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        // MPEG-1 Layer III frame sync, 320 kbps at 48 kHz.
        assert_eq!(bytes[0], 0xFF);
        assert_eq!(bytes[1] & 0xFE, 0xFA);
        assert_eq!(bytes[2] >> 4, 0b1110);
        // 2 s at 320 kbps is about 80 KB.
        assert!((70_000..95_000).contains(&bytes.len()), "{}", bytes.len());
    }

    #[test]
    fn waveform_has_fixed_bars_scaled_to_the_loudest() {
        let mut pcm = tone(48_000, 1.0);
        let half = pcm.samples.len() / 2;
        for s in &mut pcm.samples[..half] {
            *s *= 0.25;
        }
        let bars = waveform(&pcm);
        assert_eq!(bars.len(), WAVEFORM_BARS);
        assert_eq!(bars.iter().copied().fold(0f32, f32::max), 1.0);
        assert!(bars[10] < 0.3 && bars[150] > 0.9);
        assert!(waveform(&Pcm {
            sample_rate: 48_000,
            channels: 2,
            samples: vec![]
        })
        .iter()
        .all(|b| *b == 0.0));
    }

    /// AULO_LIVE_FLAC=/path/to/audio.flac cargo test live_waveform -- --ignored
    #[test]
    #[ignore]
    fn live_waveform_streams_a_real_song() {
        let path = std::path::PathBuf::from(std::env::var("AULO_LIVE_FLAC").unwrap());
        let pcm = decode_flac(&path).unwrap();
        assert_eq!(waveform_of(&path).unwrap(), waveform(&pcm));
        let frames = pcm.samples.len() / pcm.channels as usize;
        let expected = frames as f64 / pcm.sample_rate as f64;
        assert!((flac_duration(&path).unwrap() - expected).abs() < 1e-6);
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-cover-bytes-";

    fn read_back(path: &Path) -> (Option<String>, Option<Vec<u8>>) {
        use lofty::prelude::*;
        let file = lofty::read_from_path(path).unwrap();
        let tag = file.primary_tag().unwrap();
        (
            tag.title().map(|t| t.to_string()),
            tag.pictures().first().map(|p| p.data().to_vec()),
        )
    }

    fn tags() -> Tags {
        Tags {
            title: "Night Drive 夜路".into(),
            cover: Some(PNG.to_vec()),
        }
    }

    #[test]
    fn mp3_downloads_carry_title_and_cover() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.mp3");
        write_mp3(&tone(48_000, 1.0), &path).unwrap();
        let audio_before = std::fs::metadata(&path).unwrap().len();
        write_tags(&path, &tags()).unwrap();
        assert_eq!(
            read_back(&path),
            (Some("Night Drive 夜路".into()), Some(PNG.to_vec()))
        );
        assert!(std::fs::metadata(&path).unwrap().len() > audio_before);
        // Writing again replaces the cover instead of adding a second one.
        write_tags(&path, &tags()).unwrap();
        use lofty::prelude::*;
        let file = lofty::read_from_path(&path).unwrap();
        assert_eq!(file.primary_tag().unwrap().pictures().len(), 1);
    }

    #[test]
    fn an_unusual_file_is_an_error_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.flac");
        // A FLAC with a header but no audio once made the tagging library panic.
        let mut bytes = b"fLaC".to_vec();
        bytes.extend([0x80, 0, 0, 34, 0x10, 0x00, 0x10, 0x00, 0, 0, 0, 0, 0, 0]);
        let packed: u64 = (48_000 << 44) | (1 << 41) | (23 << 36) | 48_000;
        bytes.extend(packed.to_be_bytes());
        bytes.extend([0; 16]);
        std::fs::write(&path, bytes).unwrap();
        let _ = write_tags(&path, &tags());
        assert!(write_tags(&dir.path().join("missing.mp3"), &tags()).is_err());
        assert!(write_tags(&dir.path().join("t.flac").with_extension("txt"), &tags()).is_err());
    }

    /// AULO_LIVE_FLAC=/path/to/audio.flac cargo test live_flac_tags -- --ignored
    #[test]
    #[ignore = "Needs a real song"]
    fn live_flac_tags_carry_title_and_cover() {
        let source = std::path::PathBuf::from(std::env::var("AULO_LIVE_FLAC").unwrap());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.flac");
        std::fs::copy(&source, &path).unwrap();
        write_tags(&path, &tags()).unwrap();
        assert_eq!(
            read_back(&path),
            (Some("Night Drive 夜路".into()), Some(PNG.to_vec()))
        );
        // The audio itself is untouched.
        assert_eq!(
            decode_flac(&path).unwrap().samples,
            decode_flac(&source).unwrap().samples
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn m4a_downloads_carry_title_and_cover() {
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("t.wav");
        let m4a = dir.path().join("t.m4a");
        write_wav(&tone(48_000, 1.0), &wav).unwrap();
        let status = std::process::Command::new("/usr/bin/afconvert")
            .args(["-f", "m4af", "-d", "aac"])
            .arg(&wav)
            .arg(&m4a)
            .status()
            .unwrap();
        assert!(status.success());
        write_tags(&m4a, &tags()).unwrap();
        assert_eq!(
            read_back(&m4a),
            (Some("Night Drive 夜路".into()), Some(PNG.to_vec()))
        );
    }

    #[test]
    fn only_real_png_covers_are_accepted() {
        assert!(valid_cover(PNG));
        assert!(!valid_cover(b"GIF89a"));
        assert!(!valid_cover(b""));
        let mut huge = PNG.to_vec();
        huge.resize(5 * 1024 * 1024, 0);
        assert!(!valid_cover(&huge));
    }

    #[test]
    fn corrupt_flac_is_an_error_not_silence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.flac");
        std::fs::write(&path, b"not flac").unwrap();
        assert!(decode_flac(&path).is_err());
        assert!(waveform_of(&path).is_err());
        assert!(flac_duration(&path).is_none());
    }
}
