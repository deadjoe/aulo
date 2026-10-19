//! Which music engine this computer uses, decided from its hardware alone.
//!
//! Both engines are YUE2 // GROOVE's: PyTorch (the reference engine, on Apple
//! silicon through MPS) and GGUF (yue2.cpp, through Metal on a Mac and CUDA on
//! Windows). People never choose: a computer's hardware does not change, so the
//! plan is the same on every start and nothing about it is shown or adjustable.

use serde::Serialize;

use crate::Hardware;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Torch,
    Gguf,
}

impl Engine {
    pub fn name(self) -> &'static str {
        match self {
            Self::Torch => "torch",
            Self::Gguf => "gguf",
        }
    }
}

/// The context limit yue2.cpp uses on 8 GB machines (GROOVE's SMALL_CARD_MAX_SEQ):
/// about 5.5 GB at peak instead of 8.2 GB, and songs of up to about 4.9 minutes.
pub const SMALL_CONTEXT: u32 = 12_288;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub engine: Engine,
    /// A smaller context for 8 GB machines; None for the full one.
    pub context_cap: Option<u32>,
}

/// Memory is compared by its marketed size: a "16 GB" machine reports a little less.
fn marketed(gib: f64) -> u32 {
    gib.round().max(0.0) as u32
}

/// The engine for this computer, or why it cannot make songs.
///
/// - Mac with Apple silicon, 16 GB or more: PyTorch on MPS.
/// - Mac with Apple silicon, 8–15 GB: GGUF on Metal, with the small context at 8 GB.
/// - Windows with an NVIDIA card of 8 GB or more: GGUF on CUDA, the small context at 8 GB.
///   Windows uses only the GGUF engine.
pub fn plan(h: &Hardware) -> Result<Plan, &'static str> {
    match (h.platform.as_str(), h.arch.as_str()) {
        ("macos", "aarch64") => match marketed(h.memory_gi_b) {
            16.. => Ok(Plan {
                engine: Engine::Torch,
                context_cap: None,
            }),
            8..=15 => Ok(Plan {
                engine: Engine::Gguf,
                context_cap: (marketed(h.memory_gi_b) <= 8).then_some(SMALL_CONTEXT),
            }),
            _ => Err("Aulo needs a Mac with Apple silicon and at least 8 GB of memory to make music."),
        },
        ("windows", "x86_64") => match h.gpu_memory_gi_b.map(marketed) {
            Some(8..) => Ok(Plan {
                engine: Engine::Gguf,
                context_cap: (marketed(h.gpu_memory_gi_b.unwrap_or(0.0)) <= 8)
                    .then_some(SMALL_CONTEXT),
            }),
            Some(_) => {
                Err("Aulo needs an NVIDIA graphics card with at least 8 GB of memory to make music.")
            }
            None => Err("Aulo couldn’t find an NVIDIA graphics card. If this PC has one, update its driver and open Aulo again."),
        },
        ("macos", _) => Err("Aulo needs a Mac with Apple silicon to make music."),
        _ => Err("Aulo makes music on Macs with Apple silicon and on Windows PCs with an NVIDIA graphics card."),
    }
}

/// This computer's plan, worked out once per run.
pub fn current() -> Result<Plan, &'static str> {
    static PLAN: std::sync::OnceLock<Result<Plan, &'static str>> = std::sync::OnceLock::new();
    *PLAN.get_or_init(|| {
        // Development builds can try the other engine on the same computer.
        #[cfg(debug_assertions)]
        if let Ok(forced) = std::env::var("AULO_FORCE_ENGINE") {
            let engine = if forced == "gguf" {
                Engine::Gguf
            } else {
                Engine::Torch
            };
            return Ok(Plan {
                engine,
                context_cap: None,
            });
        }
        plan(&crate::collect_hardware(std::env::temp_dir()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac(memory: f64) -> Hardware {
        Hardware {
            platform: "macos".into(),
            arch: "aarch64".into(),
            chip: "Apple M3".into(),
            memory_gi_b: memory,
            free_disk_gi_b: None,
            gpu: None,
            gpu_memory_gi_b: None,
            data_path: "/test".into(),
        }
    }

    fn pc(vram: Option<f64>) -> Hardware {
        Hardware {
            platform: "windows".into(),
            arch: "x86_64".into(),
            gpu: vram.map(|_| "NVIDIA GeForce".into()),
            gpu_memory_gi_b: vram,
            ..mac(32.0)
        }
    }

    const TORCH: Plan = Plan {
        engine: Engine::Torch,
        context_cap: None,
    };
    const GGUF: Plan = Plan {
        engine: Engine::Gguf,
        context_cap: None,
    };
    const GGUF_SMALL: Plan = Plan {
        engine: Engine::Gguf,
        context_cap: Some(SMALL_CONTEXT),
    };

    #[test]
    fn macs_with_16_gb_or_more_use_pytorch_on_mps() {
        assert_eq!(plan(&mac(64.0)), Ok(TORCH));
        assert_eq!(plan(&mac(32.0)), Ok(TORCH));
        // A 16 GB Mac reports a little under 16 GiB and still counts as 16.
        assert_eq!(plan(&mac(15.6)), Ok(TORCH));
    }

    #[test]
    fn smaller_macs_use_gguf_and_8_gb_gets_the_small_context() {
        assert_eq!(plan(&mac(12.0)), Ok(GGUF));
        assert_eq!(plan(&mac(8.0)), Ok(GGUF_SMALL));
        assert!(plan(&mac(4.0)).unwrap_err().contains("8 GB"));
    }

    #[test]
    fn windows_only_ever_uses_gguf() {
        for vram in [8.0, 11.8, 12.0, 16.0, 24.0, 32.0] {
            assert_eq!(
                plan(&pc(Some(vram))).unwrap().engine,
                Engine::Gguf,
                "{vram}"
            );
        }
        assert_eq!(plan(&pc(Some(7.9))), Ok(GGUF_SMALL));
        assert_eq!(plan(&pc(Some(12.0))), Ok(GGUF));
        assert!(plan(&pc(Some(6.0))).unwrap_err().contains("8 GB"));
        assert!(plan(&pc(None))
            .unwrap_err()
            .contains("couldn’t find an NVIDIA"));
    }

    #[test]
    fn other_computers_are_told_plainly() {
        let intel = Hardware {
            arch: "x86_64".into(),
            ..mac(32.0)
        };
        assert!(plan(&intel).unwrap_err().contains("Apple silicon"));
        let linux = Hardware {
            platform: "linux".into(),
            arch: "x86_64".into(),
            ..mac(32.0)
        };
        assert!(plan(&linux).is_err());
    }
}
