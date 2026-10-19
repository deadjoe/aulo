import type { SongRequest } from "./songs";

/** A ready song idea for a first try: written for Aulo, short so it is quick to make. */
export interface Example {
  title: string;
  style: string;
  lyrics: string;
}

export const EXAMPLES: Example[] = [
  {
    title: "Paper Planes",
    style: "dreamy indie pop, jangly guitar, female vocal, bright, upbeat",
    lyrics: `[Verse]
Folded every letter that I never sent
Threw them from the window where the summer went
Watched them catch the light above the parking lot
Every word I meant and every word I forgot

[Chorus]
Paper planes, paper planes
Flying over Sunday rain
If you find one, read my name
Paper planes, paper planes`,
  },
  {
    title: "Night Drive",
    style: "synthwave, retro synths, driving beat, male vocal, nostalgic",
    lyrics: `[Verse]
Neon on the windshield and the radio low
City in the mirror where the streetlights glow
Nowhere we are going, nothing left to prove
Just the open highway and the engine's groove

[Chorus]
Drive, drive into the night
Chasing every falling light
Hold on, hold on tight
We are young tonight`,
  },
  {
    title: "Kitchen Window",
    style: "acoustic folk, warm guitar, soft female vocal, gentle, intimate",
    lyrics: `[Verse]
Morning on the kitchen window
Coffee in my mother's cup
Every little thing she told me
Comes back when the sun comes up

[Chorus]
Oh the light, oh the light
Through the kitchen window
Carry me home tonight
Through the kitchen window`,
  },
  {
    title: "Gold Sneakers",
    style: "upbeat funk, slap bass, brass, male vocal, groovy, party",
    lyrics: `[Verse]
Laced up my gold sneakers, stepping out the door
Got a little rhythm I ain't felt before
Bass line in my pocket, sunshine on my face
Everybody's moving all around the place

[Chorus]
Shine, shine, shine on the floor
Give me a little more
Shine, shine, shine on the floor
That's what the night is for`,
  },
  {
    title: "Slow Rain",
    style: "soulful r&b, smooth keys, female vocal, slow, romantic",
    lyrics: `[Verse]
Slow rain on the city, slow rain on the glass
Holding on to moments that were never meant to last
You said that you would call me when the night was through
Now the rain is falling and I'm thinking of you

[Chorus]
Stay, stay a little while
Let me see you smile
Like the slow rain
Stay a little while`,
  },
  {
    title: "Run the Hill",
    style:
      "anthemic rock, electric guitar, powerful drums, male vocal, energetic",
    lyrics: `[Verse]
Woke up with the thunder rolling in my chest
Never been the fastest but I'll give it my best
Every step is heavy and the wind is cold
I can see the top and it is shining gold

[Chorus]
Run the hill, run the hill
Never standing still
We will, we will
Run the hill`,
  },
];

/** The next example after the one at `last` (or the first when there was none). */
export function nextExample(last: number | null): number {
  return last === null ? 0 : (last + 1) % EXAMPLES.length;
}

/** True when the request holds nothing of the user's own, or only an example. */
export function freeForExample(request: SongRequest): boolean {
  const words = [request.title, request.style, request.lyrics].map((t) =>
    t.trim(),
  );
  if (words.every((t) => !t)) return true;
  return EXAMPLES.some(
    (e) =>
      e.title === words[0] && e.style === words[1] && e.lyrics === words[2],
  );
}
