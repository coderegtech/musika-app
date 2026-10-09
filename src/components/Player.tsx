import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Pressable,
  Modal,
  ScrollView,
  Platform,
  useWindowDimensions,
} from "react-native";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import { useStore } from "../store";
import { audioUri } from "../services/media";
import { seconds, Track } from "../models";
import {
  Button,
  Cover,
  Icon,
  IconButton,
  Label,
  TrackRow,
  useColors,
} from "./ui";
export function Seek({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const c = useColors();
  const [width, setWidth] = useState(1);
  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) =>
        onChange(
          Math.max(
            0,
            Math.min(
              1,
              value + (e.nativeEvent.actionName === "increment" ? 0.05 : -0.05),
            ),
          ),
        )
      }
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPress={(e) =>
        onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / width)))
      }
      style={{ height: 22, justifyContent: "center", flex: 1 }}
    >
      <View style={{ height: 3, backgroundColor: c.line, borderRadius: 3 }}>
        <View
          style={{
            height: 3,
            width: `${Math.max(0, Math.min(100, value * 100))}%`,
            backgroundColor: c.ink,
            borderRadius: 3,
          }}
        />
      </View>
    </Pressable>
  );
}
export default function Player() {
  const c = useColors(),
    s = useStore(),
    { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false),
    [showQueue, setShowQueue] = useState(false),
    [volume, setVolume] = useState(0.65),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const current = s.current;
  const upNext = s.queue.length ? s.queue : s.library;
  const uriRef = useRef<string | null>(null);
  const completed = useRef(false);
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    }).catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    player.pause();
    if (!current) {
      player.replace(null);
      return;
    }
    void audioUri(current)
      .then((uri) => {
        if (cancelled) {
          if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
          return;
        }
        if (uriRef.current?.startsWith("blob:"))
          URL.revokeObjectURL(uriRef.current);
        uriRef.current = uri;
        player.replace({ uri });
        // expo-audio's web player ignores the <audio> element's errors, so a
        // failed load would leave the UI showing "playing" with no sound.
        if (Platform.OS === "web") {
          const media: HTMLAudioElement | undefined = (player as any).media;
          media?.addEventListener("error", () => {
            if (cancelled) return;
            setReady(false);
            setFailed(true);
            s.setPlaying(false);
            s.notify("This track could not be played. Try again later.");
          });
        }
        completed.current = false;
        setReady(true);
        showNowPlaying(current);
      })
      .catch((e) => {
        if (cancelled) return;
        setFailed(true);
        s.notify(e.message);
        s.setPlaying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id, current?.localUri, attempt]);
  useEffect(() => {
    // Pressing play after a failed load retries it; the track hasn't changed,
    // so nothing else would reload the source.
    if (!ready) {
      if (s.playing && failed) setAttempt((n) => n + 1);
      return;
    }
    if (s.playing) {
      if (status.didJustFinish) void player.seekTo(0);
      player.play();
    } else player.pause();
  }, [ready, s.playing]);
  useEffect(() => {
    player.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (status.didJustFinish && !completed.current) {
      completed.current = true;
      if (s.repeat) {
        void player.seekTo(0).then(() => {
          completed.current = false;
          player.play();
        });
      } else if (upNext.length > 1) s.next();
      else s.setPlaying(false);
    } else if (!status.didJustFinish) completed.current = false;
  }, [status.didJustFinish]);
  // The lock screen / media notification is also what keeps Android playing
  // in the background; on web the Media Session API fills the same role.
  function showNowPlaying(track: Track) {
    const metadata = {
      title: track.title,
      artist: track.artist,
      artworkUrl: track.thumbnail,
    };
    if (Platform.OS !== "web") {
      player.setActiveForLockScreen(true, metadata);
      return;
    }
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      artwork: track.thumbnail ? [{ src: track.thumbnail }] : [],
    });
    navigator.mediaSession.setActionHandler("nexttrack", () =>
      useStore.getState().next(1),
    );
    navigator.mediaSession.setActionHandler("previoustrack", () =>
      useStore.getState().next(-1),
    );
  }
  const toggle = () => {
    if (current) s.setPlaying(!s.playing);
    else if (s.library[0]) s.play(s.library[0]);
    else s.notify("Download a track to start listening.");
  };
  const t = current || s.library[0];
  const compact = width < 760;
  const duration = status.duration || t?.duration || 0;
  const controls = (large = false) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: large ? 20 : 12,
      }}
    >
      <IconButton
        name="shuffle"
        label="Toggle shuffle"
        color={s.shuffle ? "#84A62F" : c.muted}
        onPress={s.toggleShuffle}
        size={16}
      />
      <IconButton
        name="skip-back"
        label="Previous track"
        onPress={() => s.next(-1)}
        size={large ? 24 : 19}
      />
      <IconButton
        name={s.playing ? "pause" : "play"}
        label={s.playing ? "Pause" : "Play"}
        onPress={toggle}
        size={large ? 27 : 21}
        color="#243B30"
        style={{
          backgroundColor: c.lime,
          width: large ? 64 : 42,
          height: large ? 64 : 42,
        }}
      />
      <IconButton
        name="skip-forward"
        label="Next track"
        onPress={() => s.next(1)}
        size={large ? 24 : 19}
      />
      <IconButton
        name="repeat"
        label="Toggle repeat"
        color={s.repeat ? "#84A62F" : c.muted}
        onPress={s.toggleRepeat}
        size={16}
      />
    </View>
  );
  return (
    <>
      <View
        style={{
          height: compact ? 76 : 94,
          backgroundColor: c.surface,
          borderTopWidth: 1,
          borderColor: c.line,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: compact ? 18 : 28,
          gap: 20,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open now playing"
          onPress={() => setExpanded(true)}
          style={{
            flex: compact ? 1 : 0.9,
            flexDirection: "row",
            alignItems: "center",
            gap: 13,
          }}
        >
          {t ? (
            <Cover uri={t.thumbnail} size={compact ? 45 : 52} />
          ) : (
            <Icon name="disc" size={36} />
          )}
          <View style={{ flex: 1, gap: 5 }}>
            <Label
              numberOfLines={1}
              style={{ fontSize: 13, fontWeight: "600" }}
            >
              {t?.title || "Your next favorite is waiting"}
            </Label>
            <Label muted numberOfLines={1} style={{ fontSize: 11 }}>
              {t?.artist || "Save a track. Make it yours."}
            </Label>
          </View>
          {!compact && t && (
            <IconButton
              name="heart"
              label="Like current track"
              color={s.likes.includes(t.id) ? "#B86C55" : c.muted}
              onPress={() => s.like(t.id)}
              size={18}
            />
          )}
        </Pressable>
        {compact ? (
          <>
            <IconButton
              name={s.playing ? "pause" : "play"}
              label={s.playing ? "Pause" : "Play"}
              onPress={toggle}
            />
            <IconButton
              name="skip-forward"
              label="Next track"
              onPress={() => s.next()}
            />
          </>
        ) : (
          <>
            <View style={{ flex: 1.25, gap: 3 }}>
              {controls()}
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Label muted style={{ fontSize: 10 }}>
                  {seconds(status.currentTime || 0)}
                </Label>
                <Seek
                  value={duration ? (status.currentTime || 0) / duration : 0}
                  label="Seek playback"
                  onChange={(v) => {
                    void player.seekTo(v * duration);
                  }}
                />
                <Label muted style={{ fontSize: 10 }}>
                  {seconds(duration)}
                </Label>
              </View>
            </View>
            <View
              style={{
                flex: 0.8,
                flexDirection: "row",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 10,
              }}
            >
              <IconButton
                name="list"
                label="Open playback queue"
                onPress={() => {
                  setShowQueue(true);
                  setExpanded(true);
                }}
                size={17}
              />
              <IconButton
                name={volume === 0 ? "volume-x" : "volume-2"}
                label="Mute audio"
                onPress={() => setVolume(volume === 0 ? 0.65 : 0)}
                size={17}
              />
              <View style={{ width: 80 }}>
                <Seek value={volume} onChange={setVolume} label="Volume" />
              </View>
              <IconButton
                name="maximize-2"
                label="Expand player"
                onPress={() => setExpanded(true)}
                size={16}
              />
            </View>
          </>
        )}
      </View>
      <Modal
        transparent
        visible={expanded}
        animationType="fade"
        onRequestClose={() => setExpanded(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#0B1A15BB",
            justifyContent: "center",
            alignItems: "center",
            padding: compact ? 12 : 30,
          }}
        >
          <View
            style={{
              backgroundColor: c.paper,
              borderRadius: 24,
              width: "100%",
              maxWidth: 520,
              maxHeight: "95%",
              padding: 26,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <Label
                style={{ fontSize: 10, letterSpacing: 2, fontWeight: "600" }}
              >
                {showQueue ? "UP NEXT" : "YOUR OWN LITTLE WORLD"}
              </Label>
              <IconButton
                name="x"
                label="Close player"
                onPress={() => setExpanded(false)}
              />
            </View>
            <ScrollView>
              {showQueue ? (
                <>
                  {upNext.map((track, i) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={i}
                      onPress={() => {
                        s.play(track, s.queue);
                        setShowQueue(false);
                      }}
                    />
                  ))}
                </>
              ) : (
                <>
                  {t && (
                    <Cover
                      uri={t.thumbnail}
                      size={300}
                      style={{
                        width: "100%",
                        height: undefined,
                        aspectRatio: 1,
                        borderRadius: 16,
                      }}
                    />
                  )}
                  <View style={{ marginTop: 24, marginBottom: 22 }}>
                    <Label serif style={{ fontSize: 32 }}>
                      {t?.title || "Nothing playing yet"}
                    </Label>
                    <Label muted style={{ marginTop: 8 }}>
                      {t?.artist || "Download your first track to begin."}
                    </Label>
                  </View>
                  <Seek
                    value={duration ? (status.currentTime || 0) / duration : 0}
                    onChange={(v) => {
                      void player.seekTo(v * duration);
                    }}
                    label="Seek playback"
                  />
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 18,
                    }}
                  >
                    <Label muted style={{ fontSize: 11 }}>
                      {seconds(status.currentTime || 0)}
                    </Label>
                    <Label muted style={{ fontSize: 11 }}>
                      {seconds(duration)}
                    </Label>
                  </View>
                  {controls(true)}
                  <View style={{ marginTop: 24, alignItems: "center" }}>
                    <Label muted style={{ fontSize: 11 }}>
                      {t?.source === "demo"
                        ? "Original Musika demo audio · 24 sec"
                        : "Playing from your offline library"}
                    </Label>
                  </View>
                </>
              )}
            </ScrollView>
            <Button
              title={showQueue ? "Back to playing" : "View playback queue"}
              icon={showQueue ? "disc" : "list"}
              secondary
              onPress={() => setShowQueue(!showQueue)}
              style={{ marginTop: 24 }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
