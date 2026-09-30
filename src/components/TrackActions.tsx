import React, { useEffect, useMemo, useState } from "react";
import { View, Pressable, TextInput } from "react-native";
import { useStore, playlistsContaining } from "../store";
import {
  DEMO,
  Track,
  artwork,
  canonicalUrl,
  duplicate,
  isLocalPlaylist,
  seconds,
} from "../models";
import { copyLink, openOnYouTube } from "../services/links";
import { Sheet, Label, Icon, Button, Cover, useColors } from "./ui";

export function PermissionCheck({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 14,
      }}
    >
      <View
        style={{
          width: 21,
          height: 21,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: c.muted,
          backgroundColor: checked ? c.lime : c.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Icon name="check" size={14} color="#263E32" />}
      </View>
      <Label muted style={{ fontSize: 12, flex: 1, lineHeight: 19 }}>
        I have permission to download and store this music, and the server has
        approved it.
      </Label>
    </Pressable>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger = false,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ hovered, pressed }: any) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        paddingVertical: 14,
        paddingHorizontal: 6,
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        opacity: pressed ? 0.5 : hovered ? 0.75 : 1,
      })}
    >
      <Icon name={icon} size={18} color={danger ? "#B66B54" : c.ink} />
      <Label style={{ fontSize: 14, color: danger ? "#B66B54" : c.ink }}>
        {label}
      </Label>
    </Pressable>
  );
}

function TrackHeader({ track }: { track: Track }) {
  const downloaded = useStore((s) => s.library.some((t) => t.id === track.id));
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        marginBottom: 12,
      }}
    >
      <Cover uri={artwork(track)} size={56} />
      <View style={{ flex: 1, gap: 5 }}>
        <Label numberOfLines={2} style={{ fontWeight: "600" }}>
          {track.title}
        </Label>
        <Label muted numberOfLines={1} style={{ fontSize: 12 }}>
          {track.artist} · {seconds(track.duration)}
          {downloaded ? " · Downloaded ✓" : ""}
        </Label>
      </View>
    </View>
  );
}

/** Choose an existing playlist or create a new one; only playlists made in Musika can be edited. */
function PlaylistPicker({
  selected,
  onSelect,
  creating,
  onCreating,
  name,
  onName,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
  creating: boolean;
  onCreating: (value: boolean) => void;
  name: string;
  onName: (value: string) => void;
}) {
  const c = useColors();
  const all = useStore((s) => s.playlists);
  const playlists = useMemo(() => all.filter(isLocalPlaylist), [all]);
  return (
    <View>
      {playlists.map((p) => (
        <ActionRow
          key={p.id}
          icon={selected === p.id && !creating ? "check-circle" : "disc"}
          label={`${p.title} · ${p.trackIds?.length || 0}`}
          onPress={() => {
            onCreating(false);
            onSelect(p.id);
          }}
        />
      ))}
      <ActionRow
        icon="plus"
        label="Create New Playlist"
        onPress={() => onCreating(true)}
      />
      {creating && (
        <TextInput
          autoFocus
          accessibilityLabel="New playlist name"
          value={name}
          onChangeText={onName}
          placeholder="Name your playlist"
          placeholderTextColor={c.muted}
          style={{
            fontSize: 14,
            color: c.ink,
            paddingVertical: 12,
            paddingHorizontal: 6,
            borderBottomWidth: 1,
            borderColor: c.line,
            marginTop: 6,
          }}
        />
      )}
    </View>
  );
}

/**
 * One host for every per-track action. Opened through `openActions(track, mode)`
 * so lists, cards, details and history rows all share the same menu.
 */
export default function TrackActions({
  onViewDetails,
  onViewLibrary,
}: {
  onViewDetails: (track: Track) => void;
  onViewLibrary: () => void;
}) {
  const c = useColors();
  const actions = useStore((s) => s.actions);
  const s = useStore();
  const [permission, setPermission] = useState(DEMO);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPermission(DEMO);
    setSelected(null);
    setCreating(false);
    setName("");
    setBusy(false);
  }, [actions?.track.id, actions?.mode]);
  const track = actions?.track;
  const mode = actions?.mode;
  const saved = track && s.library.find((t) => t.id === track.id);
  const url = track ? canonicalUrl(track) : null;
  const guarded = async (fn: () => Promise<unknown> | unknown) => {
    try {
      await fn();
    } catch (e) {
      s.notify((e as Error).message);
    }
  };
  const goDownload = (next: "download" | "downloadToPlaylist") => {
    if (!track) return;
    if (duplicate(track, s.library) === "POSSIBLE DUPLICATE") {
      // A similar track exists; the details sheet has the explicit review step.
      s.closeActions();
      s.notify("Possible duplicate. Review this track before downloading.");
      onViewDetails(track);
    } else if (next === "download" && DEMO) {
      s.closeActions();
      void guarded(() => s.enqueue([track], true));
    } else s.openActions(track, next);
  };
  const playlistTarget = async () => {
    if (creating) {
      if (!name.trim() || !track) return null;
      const id = s.addPlaylist(name.trim(), [], artwork(track));
      return id;
    }
    return selected;
  };
  const addToPlaylist = () =>
    guarded(async () => {
      if (!track) return;
      const id = await playlistTarget();
      if (!id) return;
      s.addToPlaylist(id, [saved || track]);
      const title = useStore
        .getState()
        .playlists.find((p) => p.id === id)?.title;
      s.closeActions();
      s.notify(`Added to "${title}" ✓`);
    });
  const downloadAndAdd = () =>
    guarded(async () => {
      if (!track) return;
      setBusy(true);
      try {
        const id = await playlistTarget();
        if (!id) return;
        s.closeActions();
        await s.enqueue([track], permission, false, id);
      } finally {
        setBusy(false);
      }
    });
  const title = {
    menu: "Options",
    download: "Download",
    downloadToPlaylist: "Download & Add to Playlist",
    addToPlaylist: "Add to Playlist",
    delete: "Delete download",
  }[mode || "menu"];
  const referenced = track
    ? playlistsContaining(s.playlists, track.id).filter(isLocalPlaylist)
    : [];
  const ready = creating ? !!name.trim() : !!selected;
  return (
    <Sheet visible={!!actions} onClose={s.closeActions} title={title}>
      {track && (
        <>
          <TrackHeader track={track} />
          {mode === "menu" && (
            <>
              {saved && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: c.soft,
                    padding: 12,
                    borderRadius: 10,
                    marginBottom: 8,
                  }}
                >
                  <Icon name="check-circle" size={16} />
                  <Label style={{ fontSize: 12, fontWeight: "500" }}>
                    Already downloaded — no need to download it again.
                  </Label>
                </View>
              )}
              {saved && (
                <ActionRow
                  icon="play"
                  label="Play Offline"
                  onPress={() => {
                    s.play(saved);
                    s.closeActions();
                  }}
                />
              )}
              {!saved && (
                <ActionRow
                  icon="download"
                  label={`Download ${s.format.toUpperCase()}`}
                  onPress={() => goDownload("download")}
                />
              )}
              {!saved && (
                <ActionRow
                  icon="folder-plus"
                  label="Download & Add to Playlist"
                  onPress={() => goDownload("downloadToPlaylist")}
                />
              )}
              <ActionRow
                icon="list"
                label="Add to Playlist"
                onPress={() => s.openActions(track, "addToPlaylist")}
              />
              {url && (
                <ActionRow
                  icon="link"
                  label="Copy Link"
                  onPress={() =>
                    void guarded(async () => {
                      s.closeActions();
                      try {
                        await copyLink(track);
                        s.notify("Link copied to clipboard");
                      } catch {
                        s.notify("The link could not be copied.");
                      }
                    })
                  }
                />
              )}
              {url && (
                <ActionRow
                  icon="external-link"
                  label="Open on YouTube"
                  onPress={() =>
                    void guarded(async () => {
                      s.closeActions();
                      try {
                        await openOnYouTube(track);
                      } catch {
                        s.notify("YouTube could not be opened.");
                      }
                    })
                  }
                />
              )}
              {saved && (
                <ActionRow
                  icon="disc"
                  label="View in Library"
                  onPress={() => {
                    s.closeActions();
                    onViewLibrary();
                  }}
                />
              )}
              <ActionRow
                icon="info"
                label="View Details"
                onPress={() => {
                  s.closeActions();
                  onViewDetails(track);
                }}
              />
              {saved && (
                <ActionRow
                  icon="trash-2"
                  label="Delete Download"
                  danger
                  onPress={() => s.openActions(track, "delete")}
                />
              )}
            </>
          )}
          {mode === "download" && (
            <>
              {!DEMO && (
                <PermissionCheck
                  checked={permission}
                  onChange={setPermission}
                />
              )}
              <Button
                title={
                  busy
                    ? "Adding to your queue…"
                    : `Download ${s.format.toUpperCase()}`
                }
                icon="download"
                disabled={busy || !permission}
                onPress={() =>
                  void guarded(async () => {
                    setBusy(true);
                    try {
                      s.closeActions();
                      await s.enqueue([track], permission);
                    } finally {
                      setBusy(false);
                    }
                  })
                }
              />
              <Label
                muted
                style={{ textAlign: "center", fontSize: 10, marginTop: 13 }}
              >
                {s.format.toUpperCase()} · {s.quality} kbps · Saved for offline
                listening
              </Label>
            </>
          )}
          {mode === "downloadToPlaylist" && (
            <>
              <PlaylistPicker
                selected={selected}
                onSelect={setSelected}
                creating={creating}
                onCreating={setCreating}
                name={name}
                onName={setName}
              />
              {!DEMO && (
                <PermissionCheck
                  checked={permission}
                  onChange={setPermission}
                />
              )}
              <Button
                title={busy ? "Adding to your queue…" : "Download & add"}
                icon="download"
                disabled={busy || !permission || !ready}
                onPress={() => void downloadAndAdd()}
                style={{ marginTop: 14 }}
              />
            </>
          )}
          {mode === "addToPlaylist" && (
            <>
              <PlaylistPicker
                selected={selected}
                onSelect={setSelected}
                creating={creating}
                onCreating={setCreating}
                name={name}
                onName={setName}
              />
              <Button
                title="Add to playlist"
                icon="plus"
                disabled={!ready}
                onPress={() => void addToPlaylist()}
                style={{ marginTop: 14 }}
              />
              {!saved && (
                <Label
                  muted
                  style={{ fontSize: 11, marginTop: 12, lineHeight: 17 }}
                >
                  This track isn’t downloaded yet. The playlist will keep it so
                  you can download it whenever you like.
                </Label>
              )}
            </>
          )}
          {mode === "delete" && (
            <>
              <Label style={{ fontSize: 13, lineHeight: 21 }}>
                {referenced.length
                  ? `“${track.title}” is in ${referenced.map((p) => `“${p.title}”`).join(", ")}. Deleting the downloaded file means ${referenced.length === 1 ? "that playlist" : "those playlists"} can’t play it offline. ${referenced.length === 1 ? "The playlist keeps" : "The playlists keep"} the song, so you can download it again later.`
                  : `Remove “${track.title}” from this device? You can download it again later.`}
              </Label>
              <Button
                title="Delete download"
                icon="trash-2"
                onPress={() =>
                  void guarded(async () => {
                    if (saved) await s.remove(saved);
                    s.closeActions();
                  })
                }
                style={{ marginTop: 20, backgroundColor: "#E7B7A8" }}
              />
              <Button
                secondary
                title="Cancel"
                onPress={() => s.openActions(track, "menu")}
                style={{ marginTop: 10 }}
              />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
