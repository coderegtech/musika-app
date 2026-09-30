import React, { useEffect, useRef, useState } from "react";
import { View, TextInput } from "react-native";
import { useStore, resolveTracks } from "../store";
import { DEMO, Track, artwork, totalDuration } from "../models";
import {
  Sheet,
  Label,
  Icon,
  IconButton,
  Button,
  Cover,
  TrackRow,
  useColors,
} from "./ui";
import { PermissionCheck } from "./TrackActions";

/** Overall progress for a multi-track download, then a summary once every track has settled. */
export function BatchProgress() {
  const c = useColors();
  const batch = useStore((s) => s.batch);
  const library = useStore((s) => s.library);
  const downloads = useStore((s) => s.downloads);
  const announced = useRef<Batch | null>(null);
  let downloaded = 0,
    failed = 0,
    skipped = 0,
    pending = 0;
  for (const id of batch?.ids || []) {
    const job = downloads.find((j) => j.track.id === id);
    if (library.some((t) => t.id === id)) downloaded++;
    else if (
      batch?.failed.includes(id) ||
      (job && ["FAILED", "CANCELLED"].includes(job.state))
    )
      failed++;
    else if (job?.state === "SKIPPED") skipped++;
    else pending++;
  }
  const settled = !!batch && pending === 0;
  useEffect(() => {
    if (settled && batch && announced.current !== batch) {
      announced.current = batch;
      useStore
        .getState()
        .notify(
          `${batch.label} finished. Downloaded ${downloaded}, already available ${batch.already + skipped}, failed ${failed}.`,
        );
    }
  }, [settled, batch]);
  if (!batch) return null;
  const total = batch.ids.length + batch.already;
  const done = downloaded + batch.already + skipped;
  return (
    <View
      style={{
        backgroundColor: c.soft,
        borderRadius: 13,
        padding: 16,
        marginVertical: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Label style={{ flex: 1, fontWeight: "600", fontSize: 13 }}>
          {settled
            ? `${batch.label} completed`
            : `${done} / ${total} tracks downloaded`}
        </Label>
        {settled && (
          <IconButton
            name="x"
            size={16}
            label="Dismiss download summary"
            onPress={() => useStore.getState().clearBatch()}
          />
        )}
      </View>
      <View
        style={{
          height: 4,
          backgroundColor: c.line,
          borderRadius: 4,
          marginTop: 12,
        }}
      >
        <View
          style={{
            height: 4,
            width: `${total ? (done / total) * 100 : 0}%`,
            backgroundColor: "#9AB969",
            borderRadius: 4,
          }}
        />
      </View>
      {settled ? (
        <Label style={{ fontSize: 12, lineHeight: 20, marginTop: 12 }}>
          Downloaded: {downloaded}
          {"\n"}Already available: {batch.already + skipped}
          {"\n"}Failed: {failed}
        </Label>
      ) : (
        <Label muted style={{ fontSize: 11, marginTop: 10 }}>
          One track failing never stops the rest.
        </Label>
      )}
    </View>
  );
}
type Batch = NonNullable<ReturnType<typeof useStore.getState>["batch"]>;

/** Full management of a playlist made in Musika: play, shuffle, repeat, rename, reorder, remove, download. */
export function LocalPlaylistSheet({
  playlistId,
  onClose,
  onViewDetails,
}: {
  playlistId: string | null;
  onClose: () => void;
  onViewDetails: (track: Track) => void;
}) {
  const c = useColors();
  const s = useStore();
  const playlist = s.playlists.find((p) => p.id === playlistId);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [permission, setPermission] = useState(DEMO);
  useEffect(() => {
    setEditing(false);
    setRenaming(false);
    setPermission(DEMO);
  }, [playlistId]);
  const tracks = resolveTracks(s, playlist?.trackIds);
  const has = (t: Track) => s.library.some((x) => x.id === t.id);
  const missing = tracks.filter((t) => !has(t));
  const cover = tracks[0] ? artwork(tracks[0]) : playlist?.thumbnail;
  return (
    <Sheet visible={!!playlist} onClose={onClose} title="Your playlist">
      {playlist && (
        <>
          {cover ? (
            <Cover
              uri={cover}
              size={200}
              style={{ width: "100%", height: 190, borderRadius: 12 }}
            />
          ) : null}
          {renaming ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginTop: 20,
              }}
            >
              <TextInput
                autoFocus
                accessibilityLabel="Playlist name"
                value={draft}
                onChangeText={setDraft}
                style={{
                  flex: 1,
                  fontSize: 20,
                  color: c.ink,
                  borderBottomWidth: 1,
                  borderColor: c.line,
                  paddingVertical: 8,
                }}
              />
              <Button
                small
                title="Save"
                disabled={!draft.trim()}
                onPress={() => {
                  s.renamePlaylist(playlist.id, draft.trim());
                  setRenaming(false);
                }}
              />
            </View>
          ) : (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Label serif style={{ fontSize: 31, marginTop: 20, flex: 1 }}>
                {playlist.title}
              </Label>
              <IconButton
                name="edit-2"
                label="Rename playlist"
                onPress={() => {
                  setDraft(playlist.title);
                  setRenaming(true);
                }}
              />
            </View>
          )}
          <Label muted style={{ fontSize: 12, marginTop: 8 }}>
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
            {tracks.length ? ` · ${totalDuration(tracks)}` : ""}
            {tracks.length
              ? ` · ${tracks.length - missing.length} available offline`
              : ""}
          </Label>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 18,
              alignItems: "center",
            }}
          >
            <Button
              small
              icon="play"
              title="Play"
              onPress={() => s.playTracks(tracks)}
            />
            <Button
              small
              secondary
              icon="shuffle"
              title="Shuffle"
              onPress={() => s.playTracks(tracks, { shuffle: true })}
            />
            <Button
              small
              secondary
              icon="repeat"
              title={s.repeat ? "Repeat on" : "Repeat"}
              onPress={s.toggleRepeat}
            />
            <Button
              small
              secondary
              icon="edit-3"
              title={editing ? "Done" : "Edit"}
              onPress={() => setEditing(!editing)}
            />
          </View>
          {missing.length > 0 && (
            <>
              {!DEMO && (
                <PermissionCheck
                  checked={permission}
                  onChange={setPermission}
                />
              )}
              <Button
                icon="download"
                title={`Download ${missing.length} missing ${missing.length === 1 ? "track" : "tracks"}`}
                disabled={!permission}
                onPress={() =>
                  void s
                    .downloadTracks(missing, permission, {
                      label: "Playlist download",
                    })
                    .catch((e) => s.notify(e.message))
                }
                style={{ marginTop: 6 }}
              />
            </>
          )}
          <BatchProgress />
          <View style={{ marginTop: 10 }}>
            {tracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                subtitle={`${t.artist}${has(t) ? "" : " · not downloaded"}`}
                onPress={() =>
                  has(t)
                    ? s.playTracks(tracks, { startId: t.id })
                    : (onClose(), onViewDetails(t))
                }
                onMenu={(track) => {
                  onClose();
                  s.openActions(track);
                }}
                action={
                  editing ? (
                    <View style={{ flexDirection: "row" }}>
                      <IconButton
                        name="chevron-up"
                        size={17}
                        label={`Move ${t.title} up`}
                        onPress={() => s.moveInPlaylist(playlist.id, t.id, -1)}
                      />
                      <IconButton
                        name="chevron-down"
                        size={17}
                        label={`Move ${t.title} down`}
                        onPress={() => s.moveInPlaylist(playlist.id, t.id, 1)}
                      />
                      <IconButton
                        name="x"
                        size={17}
                        label={`Remove ${t.title} from playlist`}
                        onPress={() => s.removeFromPlaylist(playlist.id, t.id)}
                      />
                    </View>
                  ) : has(t) ? (
                    <IconButton
                      name="play"
                      size={16}
                      label={`Play ${t.title}`}
                      onPress={() => s.playTracks(tracks, { startId: t.id })}
                    />
                  ) : (
                    <Icon name="cloud-off" size={16} color={c.muted} />
                  )
                }
              />
            ))}
          </View>
          {!tracks.length && (
            <Label
              muted
              style={{ fontSize: 12, lineHeight: 20, marginTop: 14 }}
            >
              This playlist is empty. Use ⋮ → Add to Playlist on any song.
            </Label>
          )}
          <Button
            secondary
            icon="trash-2"
            title="Delete playlist"
            onPress={() => {
              s.removePlaylist(playlist.id);
              onClose();
            }}
            style={{ marginTop: 22 }}
          />
          <Label
            muted
            style={{ fontSize: 11, textAlign: "center", marginTop: 10 }}
          >
            Deleting a playlist never deletes your downloaded songs.
          </Label>
        </>
      )}
    </Sheet>
  );
}
