import { Track, Playlist } from "./models";
const photo = (id: string, w = 600) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=85`;
export const HERO = photo("photo-1470225620780-dba8ba36b745", 1600);
const entries = [
  [
    "Golden hour",
    "The Daydreamers",
    "photo-1470252649378-9c29740c9fa8",
    "Indie",
  ],
  [
    "Somewhere, someday",
    "Luna Bay",
    "photo-1464822759023-fed622ff2c3b",
    "Indie",
  ],
  [
    "Soft focus",
    "Miles & the Moon",
    "photo-1519681393784-d120267933ba",
    "Chill",
  ],
  ["After the rain", "Juniper", "photo-1441974231531-c6227db76b6e", "Acoustic"],
  ["Blue in green", "Sunday Club", "photo-1518837695005-2083093ee35b", "Jazz"],
  [
    "City lights",
    "Neon Hours",
    "photo-1519501025264-65ba15a82390",
    "Electronic",
  ],
  ["Stay a little longer", "Isla", "photo-1500530855697-b586d89ba3ee", "OPM"],
  [
    "Slow mornings",
    "Paper Planes",
    "photo-1445116572660-236099ec97a0",
    "Chill",
  ],
  ["Velvet sky", "Afterglow", "photo-1470071459604-3b5ec3a7fe05", "Indie"],
  [
    "In bloom",
    "The Wildflowers",
    "photo-1490750967868-88aa4486c946",
    "Acoustic",
  ],
  ["Tides", "Coastline", "photo-1507525428034-b723cf961d3e", "Chill"],
  ["Home again", "Good Company", "photo-1449158743715-0a90ebb6d2d8", "OPM"],
];
export const demoTracks: Track[] = entries.map(
  ([title, artist, image, album], i) => ({
    id: `demo${String(i).padStart(7, "0")}`,
    source: "demo",
    title,
    artist,
    thumbnail: photo(image),
    duration: 24,
    original_title: `${artist} - ${title}`,
    original_description:
      "An original, synthesized Musika demo loop. Fictional track and artist names showcase your library. This audio is included with Musika and can be saved for offline testing.",
    channel: artist,
    source_url: "",
    classification: "MUSIC",
    album,
    release: "2026-09-01",
  }),
);
export const demoPlaylists: Playlist[] = [
  {
    id: "slow",
    title: "A little slower",
    artist: "Musika",
    description: "Take a breath. Find your own pace.",
    thumbnail: photo("photo-1472396961693-142e6e269027"),
    trackIds: [0, 2, 3, 7, 8].map((i) => demoTracks[i].id),
    color: "#DCE4D5",
  },
  {
    id: "sun",
    title: "Chasing the sun",
    artist: "Musika",
    description: "Good days deserve a good soundtrack.",
    thumbnail: photo("photo-1464822759023-fed6227db76b6e"),
    trackIds: [0, 1, 6, 9, 10].map((i) => demoTracks[i].id),
    color: "#F0DDC2",
  },
  {
    id: "late",
    title: "When the city sleeps",
    artist: "Musika",
    description: "For the hours that belong to you.",
    thumbnail: photo("photo-1519501025264-65ba15a82390"),
    trackIds: [2, 4, 5, 8].map((i) => demoTracks[i].id),
    color: "#DCD9EB",
  },
];
// Correct the mountain image used by the collection.
demoPlaylists[1].thumbnail = demoTracks[1].thumbnail;
