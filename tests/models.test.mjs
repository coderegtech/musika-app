import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, duplicate, parseVideoUrl, seconds } from "../src/models.ts";
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
