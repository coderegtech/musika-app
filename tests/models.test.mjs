import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalize,
  duplicate,
  parseVideoUrl,
  seconds,
  canonicalUrl,
  artwork,
  totalDuration,
  formatBytes,
  jobStatus,
} from "../src/models.ts";
test("normalization handles punctuation, accents and official markers", () => {
  assert.equal(normalize("Beyoncé — Halo [Official Audio]"), "beyonce halo");
});
test("accept canonical watch, short and shorts video URLs", () => {
  for (const url of [
    "https://youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/abcdefghijk?t=10",
    "https://www.youtube.com/shorts/abcdefghijk",
  ])
    assert.equal(parseVideoUrl(url), "abcdefghijk");
});
test("reject arbitrary hosts, credentials, invalid IDs and schemes", () => {
  for (const url of [
    "https://evil.test/watch?v=abcdefghijk",
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://user:pass@youtube.com/watch?v=abcdefghijk",
    "ftp://youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/tooShort",
  ])
    assert.equal(parseVideoUrl(url), null);
});
const track = {
  id: "abcdefghijk",
  source: "youtube",
  title: "After the rain",
  artist: "Juniper",
  duration: 220,
};
test("exact source duplicates take precedence over metadata", () => {
  assert.equal(
    duplicate({ ...track, title: "Changed title" }, [track]),
    "ALREADY DOWNLOADED",
  );
});
test("nearby alternate versions require review", () => {
  assert.equal(
    duplicate(
      {
        ...track,
        id: "12345678901",
        title: "After the Rain (Official Video)",
        duration: 223,
      },
      [track],
    ),
    "POSSIBLE DUPLICATE",
  );
});
test("different duration is new", () => {
  assert.equal(
    duplicate({ ...track, id: "12345678901", duration: 300 }, [track]),
    "NEW",
  );
});
test("format elapsed audio time", () => {
  assert.equal(seconds(65.8), "1:05");
});
test("canonical link is the plain watch URL, from the id or the source URL", () => {
  const expected = "https://www.youtube.com/watch?v=abcdefghijk";
  assert.equal(
    canonicalUrl({ id: "abcdefghijk", source: "youtube", source_url: "" }),
    expected,
  );
  assert.equal(
    canonicalUrl({
      id: "abcdefghijk",
      source: "youtube",
      source_url: "https://music.youtube.com/watch?v=abcdefghijk&list=RDx",
    }),
    expected,
  );
  assert.equal(
    canonicalUrl({
      id: "abcdefghijk",
      source: "youtube",
      source_url: "https://youtu.be/abcdefghijk?t=9",
    }),
    expected,
  );
});
test("no canonical link for demo audio or malformed ids and hosts", () => {
  assert.equal(
    canonicalUrl({ id: "demo0000001", source: "demo", source_url: "" }),
    null,
  );
  assert.equal(
    canonicalUrl({ id: "bad id", source: "youtube", source_url: "" }),
    null,
  );
  assert.equal(
    canonicalUrl({
      id: "bad",
      source: "youtube",
      source_url: "https://evil.test/watch?v=abcdefghijk",
    }),
    null,
  );
});
test("cached artwork is preferred so covers render offline", () => {
  assert.equal(artwork({ thumbnail: "https://x/y.jpg" }), "https://x/y.jpg");
  assert.equal(
    artwork({ thumbnail: "https://x/y.jpg", localThumbnail: "file:///t.jpg" }),
    "file:///t.jpg",
  );
});
test("playlist duration reads naturally", () => {
  assert.equal(totalDuration([{ duration: 45 }]), "45 sec");
  assert.equal(totalDuration([{ duration: 200 }, { duration: 250 }]), "7 min");
  assert.equal(
    totalDuration([{ duration: 3600 }, { duration: 300 }]),
    "1 hr 5 min",
  );
});
test("download manager status shows stage, percent, speed and size", () => {
  const track = { id: "a", title: "T", artist: "A", duration: 1 };
  assert.equal(
    jobStatus({
      id: "j",
      track,
      state: "DOWNLOADING",
      progress: 67,
      stage: "Downloading",
      speed: 1572864,
      bytes_total: 4404019,
    }),
    "Downloading · 67% · 1.5 MB/s · 4.2 MB",
  );
  assert.equal(
    jobStatus({ id: "j", track, state: "QUEUED", progress: 0 }),
    "Queued",
  );
  assert.equal(formatBytes(0), "");
});
