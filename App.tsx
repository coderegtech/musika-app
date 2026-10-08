import "./global.css";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Image,
  ImageBackground,
  Modal,
  useWindowDimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import {
  Theme,
  light,
  dark,
  useColors,
  Icon,
  IconButton,
  Label,
  Button,
  Pill,
  Cover,
  TrackCard,
  TrackRow,
  Section,
  Empty,
  Loading,
} from "./src/components/ui";
import Player from "./src/components/Player";
import GoogleButton from "./src/components/GoogleButton";
import { useStore, tickQueue } from "./src/store";
import {
  DEMO,
  Track,
  Playlist,
  duplicate,
  parseVideoUrl,
  seconds,
} from "./src/models";
import { demoTracks, HERO } from "./src/demo";
import {
  discover,
  searchMusic,
  getVideo,
  getPlaylistItems,
} from "./src/services/api";
import { restoreSession, signOut, onSessionExpired } from "./src/services/auth";

const nav = [
  ["Home", "grid"],
  ["Search", "search"],
  ["Downloads", "download"],
  ["Library", "disc"],
  ["Profile", "user"],
] as const;
const genres = [
  "For you",
  "Indie",
  "Chill",
  "OPM",
  "Acoustic",
  "Jazz",
  "Electronic",
];
function Logo({ small = false }: { small?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Image
        source={
          colors.paper === dark.paper
            ? require("./assets/logo-dark.png")
            : require("./assets/logo-light.png")
        }
        style={{ width: small ? 35 : 43, height: small ? 35 : 43 }}
      />
      <Text
        style={{
          fontSize: small ? 25 : 31,
          fontWeight: "700",
          letterSpacing: -1.8,
          color: colors.ink,
        }}
      >
        musika<Text style={{ color: "#88A552" }}>.</Text>
      </Text>
    </View>
  );
}
function AppContent() {
  const s = useStore(),
    c = useColors(),
    { width } = useWindowDimensions();
  const mobile = width < 760,
    wide = width >= 1100;
  const [hydrated, setHydrated] = useState(useStore.persist.hasHydrated());
  const [welcome, setWelcome] = useState(!DEMO);
  const [catalog, setCatalog] = useState<Track[]>(DEMO ? demoTracks : []),
    [discoveryError, setDiscoveryError] = useState("");
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState<"tracks" | "playlists">("tracks"),
    [genre, setGenre] = useState("For you");
  const [results, setResults] = useState<(Track | Playlist)[]>([]),
    [nextPage, setNextPage] = useState<string | undefined>(),
    [loading, setLoading] = useState(false),
    [searchError, setSearchError] = useState("");
  const searchVersion = useRef(0);
  const [details, setDetails] = useState<Track | null>(null),
    [playlist, setPlaylist] = useState<Playlist | null>(null),
    [playlistTracks, setPlaylistTracks] = useState<Track[]>([]),
    [playlistPage, setPlaylistPage] = useState<string | undefined>(),
    [selected, setSelected] = useState<string[]>([]),
    [playlistLoading, setPlaylistLoading] = useState(false),
    [playlistError, setPlaylistError] = useState("");
  const [detailsList, setDetailsList] = useState<Track[]>([]),
    [busy, setBusy] = useState(false),
    [allowDuplicate, setAllowDuplicate] = useState(false);
  const [paste, setPaste] = useState(false),
    [url, setUrl] = useState(""),
    [urlError, setUrlError] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("All tracks"),
    [libraryQuery, setLibraryQuery] = useState(""),
    [newPlaylist, setNewPlaylist] = useState(false),
    [playlistName, setPlaylistName] = useState(""),
    [newIds, setNewIds] = useState<string[]>([]);
  const [profileError, setProfileError] = useState(""),
    [about, setAbout] = useState(false),
    [authChecked, setAuthChecked] = useState(DEMO);
  const activeDownloads = s.downloads.filter((j) =>
    ["DOWNLOADING", "PROCESSING", "ANALYZING"].includes(j.state),
  ).length;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      s.notify((e as Error).message);
    }
  };
  useEffect(() => {
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  useEffect(
    () =>
      onSessionExpired(() => {
        s.setUser(null);
        s.notify(
          "Your session expired. Sign in again from Profile. Your offline library is still available.",
        );
      }),
    [],
  );
  useEffect(() => {
    if (!hydrated) return;
    void s
      .initialize()
      .then(() => {
        const state = useStore.getState();
        if (!state.current && state.library[0])
          useStore.setState({ current: state.library[0] });
      })
      .catch((e) =>
        s.notify("Offline storage could not initialize: " + e.message),
      );
    if (!DEMO)
      void restoreSession()
        .then((user) => {
          s.setUser(user);
          setWelcome(!user);
        })
        .catch((e) => {
          setProfileError(e.message);
          // An unreachable identity server must not lock away local audio.
          setWelcome(useStore.getState().library.length === 0);
          if (useStore.getState().library.length) s.setTab("Library");
        })
        .finally(() => setAuthChecked(true));
  }, [hydrated]);
  useEffect(() => {
    const timer = setInterval(() => void tickQueue(), DEMO ? 500 : 2500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!DEMO && !s.user) return;
    void loadDiscover();
  }, [s.user]);
  async function loadDiscover() {
    setDiscoveryError("");
    try {
      setCatalog((await discover()).items);
    } catch (e) {
      setDiscoveryError((e as Error).message);
    }
  }
  useEffect(() => {
    searchVersion.current += 1;
    if (s.tab !== "Search") return;
    const ctrl = new AbortController();
    setSearchError("");
    if (!query.trim()) {
      setResults([]);
      setNextPage(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setResults([]);
    setNextPage(undefined);
    const timer = setTimeout(() => {
      void searchMusic(query, kind, "", ctrl.signal)
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setResults(r.items);
          setNextPage(r.nextPageToken);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setSearchError(e.message);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, kind, s.tab]);
  async function loadMore() {
    const version = searchVersion.current;
    setLoading(true);
    setSearchError("");
    try {
      const r = await searchMusic(query, kind, nextPage);
      if (version !== searchVersion.current) return;
      setResults((old) => [
        ...old,
        ...r.items.filter((x) => !old.some((t) => t.id === x.id)),
      ]);
      setNextPage(r.nextPageToken);
    } catch (e) {
      if (version === searchVersion.current)
        setSearchError((e as Error).message);
    } finally {
      if (version === searchVersion.current) setLoading(false);
    }
  }
  // `list` is where the track was opened from; Play now queues it so
  // next/previous keep going through the same results.
  function openDetails(track: Track, list: Track[] = []) {
    setDetails(track);
    setDetailsList(list);
    setAllowDuplicate(false);
  }
  const canStream = (track: Track) => !DEMO && track.source === "youtube";
  function playNow(track: Track) {
    s.play(track, detailsList.filter(canStream));
    setDetails(null);
  }
  async function openPlaylist(p: Playlist, page?: string) {
    if (!page) {
      setPlaylist(p);
      setPlaylistTracks([]);
      setSelected([]);
    }
    setPlaylistError("");
    setPlaylistLoading(true);
    try {
      const r = p.id.startsWith("local-")
        ? {
            items: s.library.filter((t) => p.trackIds?.includes(t.id)),
            nextPageToken: undefined,
          }
        : await getPlaylistItems(p, page);
      setPlaylistTracks((old) =>
        page
          ? [...old, ...r.items.filter((t) => !old.some((x) => x.id === t.id))]
          : r.items,
      );
      setPlaylistPage(r.nextPageToken);
    } catch (e) {
      setPlaylistError((e as Error).message);
    } finally {
      setPlaylistLoading(false);
    }
  }
  function navigate(tab: typeof s.tab) {
    s.setTab(tab);
    setLibraryFilter("All tracks");
  }
  const contentWidth = width - (mobile ? 40 : wide ? 316 : 286);
  const columns = mobile ? 2 : wide ? 5 : 3;
  const cardWidth = (contentWidth - (columns - 1) * 20) / columns;
  const inputStyle = {
    fontSize: 14,
    color: c.ink,
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
  } as const;
  const searchBox = (large = false) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderRadius: large ? 14 : 25,
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.surface,
        paddingHorizontal: 16,
        ...(large ? { width: "100%" as const } : { width: wide ? 310 : 220 }),
      }}
    >
      <Icon name="search" size={17} color={c.muted} />
      <TextInput
        autoFocus={large}
        accessibilityLabel="Search songs or artists"
        placeholder="Search songs, artists, or a little feeling..."
        placeholderTextColor={c.muted}
        value={query}
        onFocus={() => s.setTab("Search")}
        onChangeText={setQuery}
        style={[inputStyle, { fontSize: 12 }]}
      />
      {query.length > 0 && (
        <IconButton
          name="x"
          size={14}
          label="Clear search"
          onPress={() => setQuery("")}
        />
      )}
    </View>
  );
  const playlistCard = (p: Playlist) => (
    <Pressable
      key={p.id}
      accessibilityRole="button"
      accessibilityLabel={`Open playlist ${p.title}`}
      onPress={() => void openPlaylist(p)}
      style={({ hovered }: any) => ({
        flex: 1,
        minWidth: mobile ? 250 : 180,
        opacity: hovered ? 0.85 : 1,
      })}
    >
      <ImageBackground
        source={{ uri: p.thumbnail }}
        imageStyle={{ borderRadius: 13 }}
        style={{
          height: mobile ? 190 : 170,
          borderRadius: 13,
          overflow: "hidden",
          backgroundColor: "#667D68",
        }}
      >
        <LinearGradient
          colors={["#13292100", "#132921CC"]}
          style={{ flex: 1, padding: 20, justifyContent: "flex-end" }}
        >
          <Label
            style={{
              color: "#E0F4BB",
              fontSize: 8,
              letterSpacing: 2,
              fontWeight: "600",
              marginBottom: 7,
            }}
          >
            A MUSIKA COLLECTION
          </Label>
          <Label serif style={{ fontSize: 25, color: "#fff" }}>
            {p.title}
          </Label>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <Label style={{ color: "#FFFFFFBB", fontSize: 10 }}>
              {p.trackIds?.length || "Explore"} tracks · Made for a moment
            </Label>
            <Icon name="arrow-up-right" size={18} color="white" />
          </View>
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
  if (!hydrated || !authChecked)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.paper,
          gap: 24,
        }}
      >
        <Logo />
        <ActivityIndicator color={c.ink} />
      </View>
    );
  if (welcome)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F5EF" }}>
        <View style={{ flex: 1, flexDirection: mobile ? "column" : "row" }}>
          {!mobile && (
            <ImageBackground source={{ uri: HERO }} style={{ flex: 1 }}>
              <LinearGradient
                colors={["#19352766", "#193527E6"]}
                style={{ flex: 1, justifyContent: "flex-end", padding: 64 }}
              >
                <Text
                  style={{
                    fontFamily: "Georgia",
                    fontSize: 65,
                    lineHeight: 72,
                    color: "#F2F2D8",
                  }}
                >
                  Find your sound.{"\n"}Keep it close.
                </Text>
                <Text style={{ fontSize: 16, color: "#E0E4CE", marginTop: 25 }}>
                  A little discovery. A lot of you.
                </Text>
              </LinearGradient>
            </ImageBackground>
          )}
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              padding: 36,
            }}
          >
            <View style={{ width: "100%", maxWidth: 350, gap: 26 }}>
              <Logo />
              <Text
                style={{
                  fontFamily: "Georgia",
                  fontSize: 43,
                  lineHeight: 49,
                  color: "#263E32",
                  marginTop: 20,
                }}
              >
                Your music.{"\n"}Your library.
              </Text>
              <Text style={{ fontSize: 15, lineHeight: 24, color: "#7F8A7A" }}>
                Discover something you love. Save it for later. Take it
                everywhere.
              </Text>
              <GoogleButton
                onSuccess={(u) => {
                  s.setUser(u);
                  setWelcome(false);
                  setProfileError("");
                }}
                onError={setProfileError}
              />
              {profileError && (
                <Text
                  style={{ color: "#A95140", fontSize: 12, lineHeight: 19 }}
                >
                  {profileError}
                </Text>
              )}
              {DEMO && (
                <Button
                  secondary
                  title="Explore the demo"
                  icon="arrow-right"
                  onPress={() => {
                    s.enterDemo();
                    setWelcome(false);
                  }}
                />
              )}
              <Text
                style={{
                  color: "#959B8E",
                  fontSize: 11,
                  lineHeight: 18,
                  textAlign: "center",
                }}
              >
                Made for music. Designed around you.
              </Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: c.paper }}
    >
      <View className="flex-1 flex-row">
        {!mobile && (
          <ScrollView
            style={{ width: wide ? 228 : 210, flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                flex: 1,
                width: wide ? 228 : 210,
                backgroundColor: s.theme === "dark" ? c.surface : "#EEF0E6",
                paddingHorizontal: 23,
                paddingTop: 32,
                borderRightWidth: 1,
                borderRightColor: c.line,
              }}
            >
              <Logo />
              <Label
                muted
                style={{
                  fontSize: 10,
                  letterSpacing: 0.15,
                  marginTop: 3,
                  marginLeft: 7,
                }}
              >
                Your music. Your library.
              </Label>
              <View style={{ gap: 8, marginTop: 43 }}>
                {nav.map(([name, icon]) => (
                  <Pressable
                    accessibilityRole="button"
                    key={name}
                    onPress={() => navigate(name)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 13,
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      backgroundColor:
                        s.tab === name ? c.forest : "transparent",
                    }}
                  >
                    <Icon
                      name={icon}
                      size={18}
                      color={s.tab === name ? "#E1F3B1" : c.muted}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: s.tab === name ? "600" : "500",
                        color: s.tab === name ? "#fff" : c.ink,
                      }}
                    >
                      {name}
                    </Text>
                    {name === "Downloads" && activeDownloads > 0 && (
                      <View
                        style={{
                          marginLeft: "auto",
                          borderRadius: 12,
                          backgroundColor: c.lime,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}
                      >
                        <Text style={{ fontSize: 10 }}>{activeDownloads}</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
              <View
                style={{
                  height: 1,
                  backgroundColor: c.line,
                  marginVertical: 28,
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Label
                  muted
                  style={{ fontSize: 9, letterSpacing: 1.5, fontWeight: "600" }}
                >
                  YOUR COLLECTION
                </Label>
                <IconButton
                  name="plus"
                  size={14}
                  label="Create playlist"
                  onPress={() => setNewPlaylist(true)}
                  style={{ width: 25, height: 25 }}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  s.setTab("Library");
                  setLibraryFilter("Liked songs");
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 18,
                }}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    backgroundColor: "#E4E7D8",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 6,
                  }}
                >
                  <Icon name="heart" size={14} color="#5B7159" />
                </View>
                <Label style={{ fontSize: 12 }}>Liked songs</Label>
                <Label muted style={{ marginLeft: "auto", fontSize: 10 }}>
                  {s.likes.length}
                </Label>
              </Pressable>
              {s.playlists.slice(0, 3).map((p) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${p.title}`}
                  key={p.id}
                  onPress={() => void openPlaylist(p)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Cover
                    uri={p.thumbnail}
                    size={30}
                    style={{ borderRadius: 5 }}
                  />
                  <Label numberOfLines={1} style={{ fontSize: 12, flex: 1 }}>
                    {p.title}
                  </Label>
                </Pressable>
              ))}
              <View style={{ flex: 1, minHeight: 25 }} />
              <View
                style={{
                  padding: 17,
                  backgroundColor: s.theme === "dark" ? c.paper : "#E4E8D8",
                  borderRadius: 11,
                  marginBottom: 22,
                }}
              >
                <Icon name="headphones" size={23} />
                <Label
                  style={{ fontSize: 13, fontWeight: "600", marginTop: 12 }}
                >
                  Good music. No signal.
                </Label>
                <Label
                  muted
                  style={{ fontSize: 11, lineHeight: 17, marginTop: 7 }}
                >
                  Your favorites, always with you.{"\n"}That’s the beauty of
                  offline.
                </Label>
                <Pressable
                  onPress={() => s.setTab("Library")}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                    marginTop: 14,
                  }}
                >
                  <Label style={{ fontSize: 10, fontWeight: "600" }}>
                    Explore your library
                  </Label>
                  <Icon name="arrow-right" size={12} />
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => s.setTab("Profile")}
                style={{
                  flexDirection: "row",
                  gap: 10,
                  alignItems: "center",
                  paddingBottom: 24,
                }}
              >
                <View
                  style={{
                    height: 34,
                    width: 34,
                    borderRadius: 20,
                    backgroundColor: "#D3DCC5",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Label
                    style={{
                      fontSize: 12,
                      color: "#263E32",
                      fontWeight: "600",
                    }}
                  >
                    {s.user?.name?.slice(0, 2).toUpperCase() || "M"}
                  </Label>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Label style={{ fontSize: 11, fontWeight: "600" }}>
                    {s.user?.name || "Music is personal"}
                  </Label>
                  <Label muted style={{ fontSize: 9 }}>
                    {DEMO ? "Demo workspace" : "Your personal account"}
                  </Label>
                </View>
                <Icon name="chevrons-up" size={13} />
              </Pressable>
            </View>
          </ScrollView>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{
              height: mobile ? 76 : 94,
              paddingHorizontal: mobile ? 20 : 44,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 18,
            }}
          >
            {mobile ? (
              <Logo small />
            ) : (
              <View
                style={{ flexDirection: "row", gap: 7, alignItems: "center" }}
              >
                <Icon name="sun" size={16} color={c.muted} />
                <Label muted style={{ fontSize: 12 }}>
                  A good day starts with good music.
                </Label>
              </View>
            )}
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 18 }}
            >
              {!mobile && s.tab !== "Search" && searchBox()}
              <Pressable
                accessibilityRole="button"
                onPress={() => s.setTab("Profile")}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderWidth: 1,
                  borderColor: c.line,
                  borderRadius: 20,
                  flexDirection: "row",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: "#829B53",
                  }}
                />
                <Label muted style={{ fontSize: 9, letterSpacing: 0.4 }}>
                  {DEMO ? "DEMO MODE" : "YOUR SPACE"}
                </Label>
              </Pressable>
            </View>
          </View>
          <ScrollView
            key={s.tab}
            contentContainerStyle={{
              paddingHorizontal: mobile ? 20 : 44,
              paddingBottom: 45,
            }}
            showsVerticalScrollIndicator={false}
          >
            {s.tab === "Home" && (
              <>
                <View style={{ marginTop: mobile ? 6 : 10, marginBottom: 25 }}>
                  <Label
                    serif
                    style={{ fontSize: mobile ? 35 : 43, letterSpacing: -1.5 }}
                  >
                    A little more you.
                  </Label>
                  <Label muted style={{ fontSize: 13, marginTop: 9 }}>
                    New discoveries. Old favorites. All in one place.
                  </Label>
                </View>
                <ImageBackground
                  source={{ uri: HERO }}
                  imageStyle={{ borderRadius: 17 }}
                  style={{
                    height: mobile ? 320 : 320,
                    borderRadius: 17,
                    overflow: "hidden",
                    backgroundColor: "#294734",
                    marginBottom: 32,
                  }}
                >
                  <LinearGradient
                    colors={["#142B25E8", "#18342995", "#142B2515"]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={{
                      flex: 1,
                      padding: mobile ? 26 : 36,
                      justifyContent: "center",
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                        marginBottom: 19,
                      }}
                    >
                      <View
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 5,
                          backgroundColor: "#DEEF9D",
                        }}
                      />
                      <Text
                        style={{
                          color: "#DFEBC9",
                          fontSize: 9,
                          letterSpacing: 2.4,
                          fontWeight: "600",
                        }}
                      >
                        THE DAILY DISCOVERY
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontFamily: "Georgia",
                        color: "#F6F5DC",
                        fontSize: mobile ? 41 : 49,
                        lineHeight: mobile ? 44 : 52,
                        letterSpacing: -1.5,
                      }}
                    >
                      A soundtrack{"\n"}for every you.
                    </Text>
                    <Text
                      style={{
                        color: "#D7DECD",
                        fontSize: 12,
                        lineHeight: 20,
                        marginTop: 15,
                        maxWidth: 300,
                      }}
                    >
                      Get lost in something new.{"\n"}You might just find your
                      next favorite.
                    </Text>
                    <View style={{ alignSelf: "flex-start", marginTop: 24 }}>
                      <Button
                        title="Find your next favorite"
                        icon="arrow-up-right"
                        onPress={() => {
                          s.setTab("Search");
                          setQuery(DEMO ? "" : "indie music");
                        }}
                      />
                    </View>
                    <View
                      style={{
                        position: "absolute",
                        bottom: 27,
                        right: 30,
                        flexDirection: "row",
                        gap: 5,
                      }}
                    >
                      {[0, 1, 2].map((i) => (
                        <View
                          key={i}
                          style={{
                            width: i === 0 ? 20 : 5,
                            height: 5,
                            borderRadius: 3,
                            backgroundColor: i === 0 ? "#DEF28D" : "#FFFFFF66",
                          }}
                        />
                      ))}
                    </View>
                  </LinearGradient>
                </ImageBackground>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 9, paddingBottom: 29 }}
                >
                  {genres.map((g) => (
                    <Pill
                      key={g}
                      title={g}
                      active={genre === g}
                      onPress={() => {
                        setGenre(g);
                        if (!DEMO && g !== "For you") {
                          setQuery(g + " music");
                          s.setTab("Search");
                        }
                      }}
                    />
                  ))}
                </ScrollView>
                <Section
                  title={
                    genre === "For you"
                      ? "Made for your everyday"
                      : `${genre}, for your kind of day`
                  }
                  subtitle="A fresh rotation of sounds worth keeping."
                  action="Explore all"
                  onAction={() => {
                    s.setTab("Search");
                    setQuery(DEMO ? "" : genre === "For you" ? "music" : genre);
                  }}
                />
                {discoveryError ? (
                  <Empty
                    icon="wifi-off"
                    title="A quiet moment"
                    body={discoveryError}
                    action="Try again"
                    onAction={() => void loadDiscover()}
                  />
                ) : catalog.length ? (
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}
                  >
                    {catalog
                      .filter(
                        (t) =>
                          genre === "For you" || !DEMO || t.album === genre,
                      )
                      .slice(0, mobile ? 4 : columns)
                      .map((t) => (
                        <TrackCard
                          key={t.id}
                          track={t}
                          width={cardWidth}
                          onPress={() => openDetails(t, catalog)}
                        />
                      ))}
                  </View>
                ) : (
                  <Loading />
                )}
                <View style={{ marginTop: 38 }}>
                  <Section
                    title="On repeat, offline"
                    subtitle="The ones you wanted to keep close."
                    action="Your library"
                    onAction={() => s.setTab("Library")}
                  />
                  {s.library.length ? (
                    <View
                      style={{
                        flexDirection: wide ? "row" : "column",
                        gap: wide ? 30 : 0,
                      }}
                    >
                      {s.library.slice(0, wide ? 4 : 2).map((t) => (
                        <View key={t.id} style={{ flex: 1 }}>
                          <TrackRow
                            track={t}
                            onPress={() => s.play(t)}
                            action={
                              <IconButton
                                name="play"
                                size={16}
                                label={`Play ${t.title}`}
                                onPress={() => s.play(t)}
                              />
                            }
                          />
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Empty
                      title="Make room for your favorites"
                      body="Download a discovery and it will be right here, even without a connection."
                    />
                  )}
                </View>
                <View style={{ marginTop: 35 }}>
                  <Section
                    title="There's a playlist for that"
                    subtitle="Little collections for whatever life sounds like."
                    action="View all"
                    onAction={() => {
                      s.setTab("Library");
                      setLibraryFilter("Playlists");
                    }}
                  />
                  {s.playlists.length ? (
                    <ScrollView
                      horizontal={mobile}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{
                        flexDirection: "row",
                        gap: 17,
                        ...(!mobile ? { flex: 1 } : {}),
                      }}
                    >
                      {s.playlists.slice(0, 3).map(playlistCard)}
                    </ScrollView>
                  ) : (
                    <Button
                      title="Find music playlists"
                      onPress={() => {
                        s.setTab("Search");
                        setKind("playlists");
                      }}
                    />
                  )}
                </View>
                <View
                  style={{
                    marginTop: 32,
                    paddingTop: 18,
                    borderTopWidth: 1,
                    borderColor: c.line,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <Icon name="music" size={11} color={c.muted} />
                  <Label muted style={{ fontSize: 10 }}>
                    {DEMO
                      ? "A taste of Musika · Fictional artists, original demo audio."
                      : "Discovery powered by YouTube · Stream the video or save it as MP3."}
                  </Label>
                </View>
              </>
            )}
            {s.tab === "Search" && (
              <>
                <PageTitle
                  title="Find your next favorite."
                  subtitle="A song, an artist, a feeling. Start somewhere."
                />
                {searchBox(true)}
                <View
                  style={{
                    flexDirection: "row",
                    gap: 10,
                    marginTop: 20,
                    marginBottom: 24,
                    alignItems: "center",
                  }}
                >
                  <Pill
                    title="Songs"
                    active={kind === "tracks"}
                    onPress={() => setKind("tracks")}
                  />
                  <Pill
                    title="Playlists"
                    active={kind === "playlists"}
                    onPress={() => setKind("playlists")}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setPaste(true);
                      setUrlError("");
                    }}
                    style={{
                      marginLeft: "auto",
                      flexDirection: "row",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <Icon name="link" size={14} />
                    <Label style={{ fontSize: 12 }}>Paste URL</Label>
                  </Pressable>
                </View>
                {loading && !results.length ? (
                  <Loading />
                ) : searchError ? (
                  <Empty
                    title="Let’s try that again"
                    body={searchError}
                    action="Retry search"
                    onAction={() => void loadMore()}
                  />
                ) : query.trim() ? (
                  <>
                    <Section
                      title={`${results.length} ${kind === "tracks" ? "songs" : "playlists"} to explore`}
                      subtitle={
                        DEMO
                          ? "Searching the Musika demo collection"
                          : "Music discovery powered by YouTube"
                      }
                    />
                    {results.length ? (
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: 20,
                        }}
                      >
                        {results.map((t) =>
                          "source" in t ? (
                            <TrackCard
                              key={t.id}
                              track={t}
                              width={cardWidth}
                              onPress={() =>
                                openDetails(
                                  t,
                                  results.filter(
                                    (r): r is Track => "source" in r,
                                  ),
                                )
                              }
                            />
                          ) : (
                            <View
                              key={t.id}
                              style={{
                                width: mobile ? "100%" : cardWidth * 2 + 20,
                              }}
                            >
                              {playlistCard(t)}
                            </View>
                          ),
                        )}
                      </View>
                    ) : (
                      <Empty
                        icon="search"
                        title="A different tune?"
                        body={
                          DEMO
                            ? "Try “Golden”, “Luna”, “Chill”, or “Indie” in the demo catalog."
                            : "Try a song title, an artist, or a different spelling."
                        }
                      />
                    )}
                    <View style={{ alignItems: "center", marginTop: 28 }}>
                      {nextPage ? (
                        <Button
                          title={loading ? "Finding more…" : "Load more"}
                          secondary
                          disabled={loading}
                          onPress={() => void loadMore()}
                        />
                      ) : (
                        results.length > 0 && (
                          <Label muted style={{ fontSize: 11 }}>
                            You’re all caught up.
                          </Label>
                        )
                      )}
                    </View>
                  </>
                ) : (
                  <>
                    <Section
                      title="Follow your mood"
                      subtitle="There’s no wrong place to start."
                    />
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 15,
                      }}
                    >
                      {genres.slice(1).map((g, i) => (
                        <Pressable
                          accessibilityRole="button"
                          key={g}
                          onPress={() => setQuery(g)}
                          style={{
                            width: mobile
                              ? (contentWidth - 15) / 2
                              : (contentWidth - 30) / 3,
                            height: 140,
                            padding: 22,
                            borderRadius: 14,
                            backgroundColor: [
                              "#DDE7CF",
                              "#EBDDCB",
                              "#DED9E9",
                              "#D2E1DB",
                              "#E8D5D0",
                              "#D4DEE5",
                            ][i],
                            overflow: "hidden",
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: "Georgia",
                              fontSize: 28,
                              color: "#263E32",
                            }}
                          >
                            {g}
                          </Text>
                          <Icon
                            name={
                              (
                                [
                                  "sun",
                                  "cloud",
                                  "heart",
                                  "feather",
                                  "coffee",
                                  "radio",
                                ] as const
                              )[i]
                            }
                            size={60}
                            color="#263E3233"
                            style={{
                              position: "absolute",
                              bottom: 12,
                              right: 15,
                              transform: [{ rotate: "-15deg" }],
                            }}
                          />
                          <Icon
                            name="arrow-up-right"
                            size={15}
                            color="#263E32"
                            style={{
                              position: "absolute",
                              bottom: 20,
                              left: 22,
                            }}
                          />
                        </Pressable>
                      ))}
                    </View>
                    {kind === "tracks" && (
                      <View style={{ marginTop: 32 }}>
                        <Section title="Worth a listen" />
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: 20,
                          }}
                        >
                          {catalog.slice(0, mobile ? 4 : columns).map((t) => (
                            <TrackCard
                              key={t.id}
                              width={cardWidth}
                              track={t}
                              onPress={() => openDetails(t, catalog)}
                            />
                          ))}
                        </View>
                      </View>
                    )}
                  </>
                )}
              </>
            )}
            {s.tab === "Downloads" && (
              <>
                <PageTitle
                  title="Coming along for the ride."
                  subtitle="A little patience. A lot of good music."
                />
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 26,
                  }}
                >
                  {[
                    ["In progress", activeDownloads],
                    [
                      "Queued",
                      s.downloads.filter((j) => j.state === "QUEUED").length,
                    ],
                    [
                      "Completed",
                      s.downloads.filter((j) => j.state === "COMPLETED").length,
                    ],
                    [
                      "Skipped",
                      s.downloads.filter((j) => j.state === "SKIPPED").length,
                    ],
                  ].map(([label, count]) => (
                    <View
                      key={label}
                      style={{
                        flex: 1,
                        minWidth: 100,
                        backgroundColor: c.soft,
                        padding: 20,
                        borderRadius: 13,
                      }}
                    >
                      <Label serif style={{ fontSize: 32 }}>
                        {count}
                      </Label>
                      <Label muted style={{ fontSize: 11, marginTop: 5 }}>
                        {label}
                      </Label>
                    </View>
                  ))}
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 10,
                    marginBottom: 24,
                  }}
                >
                  <Button
                    secondary
                    small
                    icon={s.paused ? "play" : "pause"}
                    title={s.paused ? "Resume queue" : "Pause queue"}
                    onPress={() =>
                      void run(() =>
                        s.queueAction(s.paused ? "resume" : "pause"),
                      )
                    }
                  />
                  <Button
                    secondary
                    small
                    icon="rotate-cw"
                    title="Retry failed"
                    onPress={() => void run(() => s.queueAction("retry"))}
                  />
                  <Button
                    secondary
                    small
                    title="Clear completed"
                    onPress={() => void run(() => s.queueAction("clear"))}
                  />
                </View>
                {s.paused && (
                  <Label muted style={{ marginBottom: 20, fontSize: 12 }}>
                    Queue paused. Active downloads finish; waiting tracks stay
                    in place.
                  </Label>
                )}
                {s.downloads.length ? (
                  s.downloads.map((job) => (
                    <View
                      key={job.id}
                      style={{
                        marginBottom: 10,
                        padding: 17,
                        backgroundColor: c.surface,
                        borderRadius: 13,
                      }}
                    >
                      <TrackRow
                        track={job.track}
                        subtitle={`${job.track.artist} · ${job.state.toLowerCase()}`}
                        onPress={() => openDetails(job.track)}
                        action={
                          ["FAILED", "CANCELLED"].includes(job.state) ? (
                            <IconButton
                              name="rotate-cw"
                              label={`Retry ${job.track.title}`}
                              onPress={() =>
                                void run(() => s.queueAction("retry", job.id))
                              }
                            />
                          ) : job.state === "COMPLETED" ? (
                            <IconButton
                              name="play"
                              label={`Play ${job.track.title}`}
                              onPress={() => s.play(job.track)}
                            />
                          ) : ["SKIPPED"].includes(job.state) ? (
                            <Icon name="check" />
                          ) : (
                            <IconButton
                              name="x"
                              label={`Cancel ${job.track.title}`}
                              onPress={() =>
                                void run(() => s.queueAction("cancel", job.id))
                              }
                            />
                          )
                        }
                      />
                      <View
                        style={{
                          height: 3,
                          backgroundColor: c.soft,
                          marginTop: 15,
                          borderRadius: 3,
                        }}
                      >
                        <View
                          style={{
                            height: 3,
                            width: `${job.progress}%`,
                            backgroundColor: "#9AB969",
                            borderRadius: 3,
                          }}
                        />
                      </View>
                      {job.error && (
                        <Label
                          style={{
                            color: "#BA6B52",
                            fontSize: 11,
                            marginTop: 10,
                          }}
                        >
                          {job.error}
                        </Label>
                      )}
                      {job.warning && (
                        <Label muted style={{ fontSize: 11, marginTop: 10 }}>
                          {job.warning}
                        </Label>
                      )}
                    </View>
                  ))
                ) : (
                  <Empty
                    icon="download-cloud"
                    title="Nothing in the queue. Yet."
                    body="Find a song you love and save it. We’ll take care of the rest."
                    action="Discover music"
                    onAction={() => s.setTab("Search")}
                  />
                )}
                <Label muted style={{ fontSize: 11, marginTop: 25 }}>
                  Up to 3 downloads at once · {s.format.toUpperCase()} ·{" "}
                  {s.quality} kbps
                  {DEMO ? " · Demo files use bundled WAV audio" : ""}
                </Label>
              </>
            )}
            {s.tab === "Library" && (
              <>
                <PageTitle
                  title="Yours, wherever you go."
                  subtitle={`${s.library.length} saved tracks. Zero need for a signal.`}
                />
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 10,
                    marginBottom: 22,
                  }}
                >
                  {[
                    "All tracks",
                    "Liked songs",
                    "Playlists",
                    "Artists",
                    "Albums",
                  ].map((f) => (
                    <Pill
                      key={f}
                      title={f}
                      active={libraryFilter === f}
                      onPress={() => setLibraryFilter(f)}
                    />
                  ))}
                </View>
                {libraryFilter === "Playlists" ? (
                  <>
                    <View
                      style={{ alignItems: "flex-start", marginBottom: 22 }}
                    >
                      <Button
                        title="Create playlist"
                        icon="plus"
                        onPress={() => setNewPlaylist(true)}
                      />
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 18,
                      }}
                    >
                      {s.playlists.map((p) => (
                        <View
                          key={p.id}
                          style={{
                            width: mobile ? "100%" : (contentWidth - 18) / 2,
                          }}
                        >
                          {playlistCard(p)}
                        </View>
                      ))}
                    </View>
                  </>
                ) : libraryFilter === "Artists" ||
                  libraryFilter === "Albums" ? (
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}
                  >
                    {Array.from(
                      new Set(
                        s.library.map((t) =>
                          libraryFilter === "Artists"
                            ? t.artist
                            : t.album || "Singles",
                        ),
                      ),
                    ).map((name) => {
                      const tracks = s.library.filter(
                        (t) =>
                          (libraryFilter === "Artists"
                            ? t.artist
                            : t.album || "Singles") === name,
                      );
                      return (
                        <Pressable
                          accessibilityRole="button"
                          key={name}
                          onPress={() => {
                            setLibraryFilter("All tracks");
                            setLibraryQuery(name);
                          }}
                          style={{ width: cardWidth }}
                        >
                          <Cover
                            uri={tracks[0].thumbnail}
                            size={cardWidth}
                            style={{
                              borderRadius:
                                libraryFilter === "Artists"
                                  ? cardWidth / 2
                                  : 12,
                            }}
                          />
                          <Label style={{ marginTop: 12, fontWeight: "600" }}>
                            {name}
                          </Label>
                          <Label muted style={{ fontSize: 11, marginTop: 5 }}>
                            {tracks.length} tracks
                          </Label>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 20,
                      }}
                    >
                      <View
                        style={{
                          flex: 1,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          borderWidth: 1,
                          borderColor: c.line,
                          borderRadius: 25,
                          paddingHorizontal: 14,
                        }}
                      >
                        <Icon name="search" size={16} color={c.muted} />
                        <TextInput
                          accessibilityLabel="Search your library"
                          value={libraryQuery}
                          onChangeText={setLibraryQuery}
                          placeholder="Find it in your library"
                          placeholderTextColor={c.muted}
                          style={inputStyle}
                        />
                        {libraryQuery !== "" && (
                          <IconButton
                            name="x"
                            size={14}
                            label="Clear library search"
                            onPress={() => setLibraryQuery("")}
                          />
                        )}
                      </View>
                      <Button
                        title="Play all"
                        icon="play"
                        onPress={() => {
                          const t = s.library.find(
                            (t) =>
                              libraryFilter !== "Liked songs" ||
                              s.likes.includes(t.id),
                          );
                          if (t) s.play(t);
                          else s.notify("Save a few favorites first.");
                        }}
                      />
                    </View>
                    {s.library
                      .filter(
                        (t) =>
                          (libraryFilter !== "Liked songs" ||
                            s.likes.includes(t.id)) &&
                          (t.title + " " + t.artist + " " + t.album)
                            .toLowerCase()
                            .includes(libraryQuery.toLowerCase()),
                      )
                      .map((t, i) => (
                        <TrackRow
                          key={t.id}
                          track={t}
                          index={mobile ? undefined : i}
                          onPress={() => openDetails(t)}
                          action={
                            <>
                              <IconButton
                                name="heart"
                                label={`Like ${t.title}`}
                                size={17}
                                color={
                                  s.likes.includes(t.id) ? "#B66B54" : c.muted
                                }
                                onPress={() => s.like(t.id)}
                              />
                              <IconButton
                                name="play"
                                label={`Play ${t.title}`}
                                size={17}
                                onPress={() => s.play(t)}
                              />
                            </>
                          }
                        />
                      ))}
                    {(!s.library.length ||
                      (libraryFilter === "Liked songs" && !s.likes.length)) && (
                      <Empty
                        icon="heart"
                        title={
                          libraryFilter === "Liked songs"
                            ? "Keep the good ones close."
                            : "Your library starts with a song."
                        }
                        body={
                          libraryFilter === "Liked songs"
                            ? "Tap the heart on a track to make a little collection of favorites."
                            : "Discover music and save your first track for offline listening."
                        }
                      />
                    )}
                  </>
                )}
              </>
            )}
            {s.tab === "Profile" && (
              <>
                <PageTitle
                  title="Your own little corner."
                  subtitle="Make Musika feel like you."
                />
                <View
                  style={{
                    backgroundColor: c.soft,
                    borderRadius: 18,
                    padding: 25,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 20,
                    marginBottom: 28,
                  }}
                >
                  {s.user?.picture ? (
                    <Cover
                      uri={s.user.picture}
                      size={70}
                      style={{ borderRadius: 40 }}
                    />
                  ) : (
                    <View
                      style={{
                        width: 70,
                        height: 70,
                        borderRadius: 40,
                        backgroundColor: c.lime,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name="user" size={29} color="#263E32" />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 6 }}>
                    <Label serif style={{ fontSize: 27 }}>
                      {s.user?.name || "Hello, music lover."}
                    </Label>
                    <Label muted style={{ fontSize: 12 }}>
                      {s.user?.email || "Your personal Musika demo"}
                    </Label>
                  </View>
                  {!mobile && <Icon name="sun" size={30} color={c.muted} />}
                </View>
                <Setting
                  title="Audio format"
                  description="Your preferred format for new downloads."
                >
                  <View style={{ flexDirection: "row", gap: 7 }}>
                    {(["mp3", "m4a", "opus"] as const).map((f) => (
                      <Pill
                        key={f}
                        title={f.toUpperCase()}
                        active={s.format === f}
                        onPress={() => s.setSetting("format", f)}
                      />
                    ))}
                  </View>
                </Setting>
                <Setting
                  title="Audio quality"
                  description="Higher quality uses more storage."
                >
                  <View
                    style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}
                  >
                    {([128, 192, 256, 320] as const).map((q) => (
                      <Pill
                        key={q}
                        title={`${q} kbps`}
                        active={s.quality === q}
                        onPress={() => s.setSetting("quality", q)}
                      />
                    ))}
                  </View>
                </Setting>
                <Setting
                  title="Appearance"
                  description="Set the mood for your space."
                >
                  <View style={{ flexDirection: "row", gap: 7 }}>
                    <Pill
                      title="Light"
                      active={s.theme === "light"}
                      onPress={() => s.setSetting("theme", "light")}
                    />
                    <Pill
                      title="Dark"
                      active={s.theme === "dark"}
                      onPress={() => s.setSetting("theme", "dark")}
                    />
                  </View>
                </Setting>
                <Setting
                  title="Your offline storage"
                  description={`${s.library.length} tracks · ${(s.library.reduce((n, t) => n + (t.bytes || 0), 0) / 1024 / 1024).toFixed(1)} MB saved on this device`}
                >
                  <Button
                    small
                    secondary
                    title="Manage library"
                    icon="arrow-up-right"
                    onPress={() => s.setTab("Library")}
                  />
                </Setting>
                <Setting
                  title="Manage downloads"
                  description={`${s.downloads.filter((j) => j.state === "QUEUED").length} tracks waiting in your queue`}
                >
                  <Button
                    small
                    secondary
                    title="View downloads"
                    onPress={() => s.setTab("Downloads")}
                  />
                </Setting>
                <Setting
                  title="About Musika"
                  description="Your music. Your library. Version 1.0.0"
                >
                  <Button
                    small
                    secondary
                    title="The little details"
                    onPress={() => setAbout(true)}
                  />
                </Setting>
                <View style={{ marginTop: 26, alignItems: "flex-start" }}>
                  <Button
                    secondary
                    title={s.user ? "Sign out" : "Continue with Google"}
                    icon={s.user ? "log-out" : "user"}
                    onPress={() =>
                      void run(async () => {
                        if (s.user) {
                          await signOut();
                          s.setUser(null);
                          s.setPlaying(false);
                        }
                        setWelcome(true);
                      })
                    }
                  />
                </View>
                {DEMO && (
                  <Label
                    muted
                    style={{ fontSize: 11, lineHeight: 19, marginTop: 20 }}
                  >
                    You’re exploring a demo with fictional artists and original
                    audio. Google sign-in and YouTube discovery become available
                    once your server and OAuth credentials are configured.
                  </Label>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
      <Player />
      {mobile && (
        <View
          style={{
            flexDirection: "row",
            backgroundColor: c.surface,
            borderTopWidth: 1,
            borderColor: c.line,
            paddingTop: 8,
            paddingBottom: Platform.OS === "ios" ? 24 : 12,
          }}
        >
          {nav.map(([name, icon]) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected: s.tab === name }}
              key={name}
              onPress={() => navigate(name)}
              style={{ flex: 1, alignItems: "center", gap: 5, padding: 4 }}
            >
              <Icon
                name={icon}
                size={19}
                color={s.tab === name ? c.ink : c.muted}
              />
              <Label
                style={{
                  fontSize: 9,
                  fontWeight: s.tab === name ? "700" : "400",
                  color: s.tab === name ? c.ink : c.muted,
                }}
              >
                {name}
              </Label>
              {s.tab === name && (
                <View
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: 3,
                    backgroundColor: c.ink,
                  }}
                />
              )}
            </Pressable>
          ))}
        </View>
      )}
      {s.toast && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: mobile ? 162 : 112,
            left: mobile ? 20 : 260,
            right: 20,
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: "#263E32",
              borderRadius: 12,
              paddingVertical: 14,
              paddingHorizontal: 22,
              maxWidth: 550,
              boxShadow: "0px 5px 25px #00000022",
            }}
          >
            <Text style={{ color: "#F2F3E9", fontSize: 13, lineHeight: 20 }}>
              {s.toast}
            </Text>
          </View>
        </View>
      )}
      <Sheet
        visible={!!details}
        onClose={() => setDetails(null)}
        title="A closer listen"
      >
        {details && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play now"
              disabled={!canStream(details)}
              onPress={() => playNow(details)}
            >
              <Cover
                uri={details.thumbnail}
                size={300}
                style={{
                  width: "100%",
                  height: undefined,
                  aspectRatio: 1.35,
                  borderRadius: 13,
                }}
              />
              {canStream(details) && (
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 62,
                      height: 62,
                      borderRadius: 31,
                      backgroundColor: c.lime,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="play" size={26} color="#243B30" />
                  </View>
                </View>
              )}
            </Pressable>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginTop: 23,
              }}
            >
              <View style={{ flex: 1 }}>
                <Label serif style={{ fontSize: 32 }}>
                  {details.title}
                </Label>
                <Label muted style={{ marginTop: 7 }}>
                  {details.artist} · {seconds(details.duration)}
                </Label>
              </View>
              <IconButton
                name="heart"
                label="Like track"
                color={s.likes.includes(details.id) ? "#B66B54" : c.muted}
                onPress={() => s.like(details.id)}
              />
            </View>
            <Label
              muted
              style={{ fontSize: 12, lineHeight: 20, marginTop: 20 }}
            >
              {details.original_description.slice(0, 360) ||
                "A new discovery, ready for your library."}
            </Label>
            <View
              style={{
                paddingVertical: 15,
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
              }}
            >
              <Icon
                name={
                  duplicate(details, s.library) === "NEW"
                    ? "music"
                    : "check-circle"
                }
                size={15}
              />
              <Label style={{ fontSize: 12, fontWeight: "500" }}>
                {duplicate(details, s.library) === "ALREADY DOWNLOADED"
                  ? "Already in your Musika library."
                  : duplicate(details, s.library) === "POSSIBLE DUPLICATE"
                    ? "Possible duplicate — a similar track is already saved."
                    : "A fresh find for your library."}
              </Label>
            </View>
            {duplicate(details, s.library) === "ALREADY DOWNLOADED" ? (
              <>
                <Button
                  title="Play from your library"
                  icon="play"
                  onPress={() => {
                    s.play(details);
                    setDetails(null);
                  }}
                />
                <Button
                  secondary
                  title="View in library"
                  onPress={() => {
                    setDetails(null);
                    s.setTab("Library");
                  }}
                  style={{ marginTop: 10 }}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void run(async () => {
                      await s.remove(
                        s.library.find((t) => t.id === details.id)!,
                      );
                      setDetails(null);
                    })
                  }
                  style={{ padding: 16, alignItems: "center" }}
                >
                  <Label muted style={{ fontSize: 11 }}>
                    Remove download from this device
                  </Label>
                </Pressable>
              </>
            ) : (
              <>
                {canStream(details) && (
                  <Button
                    title="Play now"
                    icon="play"
                    onPress={() => playNow(details)}
                    style={{ marginBottom: 10 }}
                  />
                )}
                {duplicate(details, s.library) === "POSSIBLE DUPLICATE" && (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: allowDuplicate }}
                    onPress={() => setAllowDuplicate(!allowDuplicate)}
                    style={{ paddingVertical: 12 }}
                  >
                    <Label style={{ fontSize: 12 }}>
                      {allowDuplicate ? "☑" : "☐"} I reviewed this version and
                      want to save it.
                    </Label>
                  </Pressable>
                )}
                <Button
                  secondary={canStream(details)}
                  title={
                    busy
                      ? "Adding to your queue…"
                      : DEMO
                        ? "Download to your library"
                        : `Download ${s.format.toUpperCase()} to this device`
                  }
                  icon="download"
                  disabled={
                    busy ||
                    (duplicate(details, s.library) === "POSSIBLE DUPLICATE" &&
                      !allowDuplicate)
                  }
                  onPress={() =>
                    void run(async () => {
                      setBusy(true);
                      try {
                        await s.enqueue([details], allowDuplicate);
                        setDetails(null);
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
                  {DEMO
                    ? "Bundled original audio · WAV"
                    : `Converted to ${s.format.toUpperCase()} · ${s.quality} kbps · Saved on this device for offline listening`}
                </Label>
              </>
            )}
          </>
        )}
      </Sheet>
      <Sheet
        visible={!!playlist}
        onClose={() => setPlaylist(null)}
        title="A collection for you"
      >
        {playlist && (
          <>
            <Cover
              uri={playlist.thumbnail}
              size={200}
              style={{ width: "100%", height: 190, borderRadius: 12 }}
            />
            <Label serif style={{ fontSize: 31, marginTop: 20 }}>
              {playlist.title}
            </Label>
            <Label muted style={{ fontSize: 12, marginTop: 7, lineHeight: 20 }}>
              {playlist.description || `Curated by ${playlist.artist}`}
            </Label>
            <Label muted style={{ fontSize: 11, marginTop: 14 }}>
              {playlistTracks.length} tracks ·{" "}
              {
                playlistTracks.filter((t) => duplicate(t, s.library) === "NEW")
                  .length
              }{" "}
              new ·{" "}
              {
                playlistTracks.filter(
                  (t) => duplicate(t, s.library) === "ALREADY DOWNLOADED",
                ).length
              }{" "}
              downloaded ·{" "}
              {
                playlistTracks.filter(
                  (t) => duplicate(t, s.library) === "POSSIBLE DUPLICATE",
                ).length
              }{" "}
              possible duplicates
            </Label>
            <View style={{ flexDirection: "row", gap: 10, marginVertical: 18 }}>
              <Button
                small
                secondary
                title="Select new"
                onPress={() =>
                  setSelected(
                    playlistTracks
                      .filter((t) => duplicate(t, s.library) === "NEW")
                      .map((t) => t.id),
                  )
                }
              />
              <Button
                small
                secondary
                title="Clear selection"
                onPress={() => setSelected([])}
              />
            </View>
            {playlistTracks.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                subtitle={`${t.artist} · ${duplicate(t, s.library).toLowerCase()}`}
                onPress={() => {
                  setPlaylist(null);
                  openDetails(t);
                }}
                action={
                  duplicate(t, s.library) === "NEW" ? (
                    <IconButton
                      name={selected.includes(t.id) ? "check-square" : "square"}
                      label={`Select ${t.title}`}
                      onPress={() =>
                        setSelected(
                          selected.includes(t.id)
                            ? selected.filter((x) => x !== t.id)
                            : [...selected, t.id],
                        )
                      }
                    />
                  ) : (
                    <Icon name="check" size={17} />
                  )
                }
              />
            ))}
            {playlistLoading && <Loading />}
            {playlistError && (
              <Empty
                title="Playlist unavailable"
                body={playlistError}
                action="Retry"
                onAction={() => void openPlaylist(playlist)}
              />
            )}{" "}
            {playlistPage && (
              <Button
                secondary
                title="Load more tracks"
                disabled={playlistLoading}
                onPress={() => void openPlaylist(playlist, playlistPage)}
                style={{ marginTop: 15 }}
              />
            )}
            <Button
              title={`Download ${selected.length} ${selected.length === 1 ? "track" : "tracks"}`}
              icon="download"
              disabled={!selected.length || busy}
              style={{ marginTop: 18 }}
              onPress={() =>
                void run(async () => {
                  setBusy(true);
                  try {
                    await s.enqueue(
                      playlistTracks.filter((t) => selected.includes(t.id)),
                    );
                    setPlaylist(null);
                  } finally {
                    setBusy(false);
                  }
                })
              }
            />
            {playlist.id.startsWith("local-") && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  s.removePlaylist(playlist.id);
                  setPlaylist(null);
                }}
                style={{ padding: 16, alignItems: "center" }}
              >
                <Label muted style={{ fontSize: 11 }}>
                  Delete this playlist
                </Label>
              </Pressable>
            )}
          </>
        )}
      </Sheet>
      <Sheet
        visible={paste}
        onClose={() => setPaste(false)}
        title="Already have a song in mind?"
      >
        <Label muted style={{ lineHeight: 22, marginBottom: 22 }}>
          Paste a YouTube video link to see its details before saving it.
        </Label>
        <View
          style={{
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 12,
            padding: 10,
          }}
        >
          <TextInput
            accessibilityLabel="YouTube URL"
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.youtube.com/watch?v=…"
            placeholderTextColor={c.muted}
            style={inputStyle}
            autoCapitalize="none"
          />
        </View>
        {urlError && (
          <Label
            style={{
              color: "#AE624D",
              fontSize: 12,
              lineHeight: 20,
              marginTop: 14,
            }}
          >
            {urlError}
          </Label>
        )}
        <Button
          title={busy ? "Finding your song…" : "Find song"}
          disabled={busy}
          onPress={() =>
            void (async () => {
              const id = parseVideoUrl(url);
              if (!id) {
                setUrlError("Enter a valid YouTube video link.");
                return;
              }
              setBusy(true);
              try {
                const track = await getVideo(id!);
                setPaste(false);
                openDetails(track);
              } catch (e) {
                setUrlError((e as Error).message);
              } finally {
                setBusy(false);
              }
            })()
          }
          style={{ marginTop: 22 }}
        />
      </Sheet>
      <Sheet
        visible={newPlaylist}
        onClose={() => setNewPlaylist(false)}
        title="Make a little collection."
      >
        <TextInput
          accessibilityLabel="Playlist name"
          value={playlistName}
          onChangeText={setPlaylistName}
          placeholder="Give your playlist a name"
          placeholderTextColor={c.muted}
          style={[
            inputStyle,
            {
              flex: undefined,
              borderBottomWidth: 1,
              borderColor: c.line,
              marginBottom: 18,
            },
          ]}
        />
        <Label muted style={{ fontSize: 12, marginBottom: 10 }}>
          Choose tracks from your offline library.
        </Label>
        {s.library.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            onPress={() =>
              setNewIds(
                newIds.includes(t.id)
                  ? newIds.filter((x) => x !== t.id)
                  : [...newIds, t.id],
              )
            }
            action={
              <IconButton
                name={newIds.includes(t.id) ? "check-square" : "square"}
                label={`Add ${t.title}`}
                onPress={() =>
                  setNewIds(
                    newIds.includes(t.id)
                      ? newIds.filter((x) => x !== t.id)
                      : [...newIds, t.id],
                  )
                }
              />
            }
          />
        ))}
        <Button
          title={`Create playlist · ${newIds.length} tracks`}
          disabled={!playlistName.trim()}
          onPress={() => {
            s.addPlaylist(playlistName.trim(), newIds);
            setNewPlaylist(false);
            setPlaylistName("");
            setNewIds([]);
          }}
          style={{ marginTop: 24 }}
        />
      </Sheet>
      <Sheet
        visible={about}
        onClose={() => setAbout(false)}
        title="Made for your kind of music."
      >
        <Logo />
        <Label serif style={{ fontSize: 30, marginTop: 24 }}>
          Your music. Your library.
        </Label>
        <Label muted style={{ lineHeight: 23, marginTop: 18 }}>
          Musika brings discovery, thoughtful collections, and offline listening
          into one quiet little space. Search for music, keep what you love, and
          listen wherever life takes you.
        </Label>
        <Label muted style={{ lineHeight: 21, marginTop: 18, fontSize: 12 }}>
          Version 1.0.0{"\n"}Discovery: YouTube Data API{"\n"}Local library:
          SQLite on Android and iOS{"\n"}Playback: Expo Audio{"\n"}Demo:
          original synthesized loops with fictional artists
        </Label>
      </Sheet>
    </SafeAreaView>
  );
}
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ marginTop: 12, marginBottom: 30 }}>
      <Label serif style={{ fontSize: 36, letterSpacing: -1 }}>
        {title}
      </Label>
      <Label muted style={{ fontSize: 13, marginTop: 10, lineHeight: 20 }}>
        {subtitle}
      </Label>
    </View>
  );
}
function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const c = useColors(),
    { width } = useWindowDimensions();
  return (
    <View
      style={{
        paddingVertical: 24,
        borderBottomWidth: 1,
        borderColor: c.line,
        flexDirection: width < 1050 ? "column" : "row",
        gap: 18,
        alignItems: width < 1050 ? "flex-start" : "center",
        justifyContent: "space-between",
      }}
    >
      <View style={{ flex: 1, gap: 7 }}>
        <Label style={{ fontWeight: "600", fontSize: 14 }}>{title}</Label>
        <Label muted style={{ fontSize: 12, lineHeight: 19 }}>
          {description}
        </Label>
      </View>
      {children}
    </View>
  );
}
function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const c = useColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#0C1D17AA",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <Pressable
          accessibilityLabel="Close dialog"
          onPress={onClose}
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <View
          style={{
            maxWidth: 530,
            width: "100%",
            maxHeight: "94%",
            backgroundColor: c.paper,
            borderRadius: 23,
            padding: 25,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 17,
            }}
          >
            <Label style={{ fontSize: 12, fontWeight: "600", flex: 1 }}>
              {title}
            </Label>
            <IconButton name="x" label="Close dialog" onPress={onClose} />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export default function App() {
  const theme = useStore((s) => s.theme);
  return (
    <SafeAreaProvider>
      <Theme.Provider value={theme === "dark" ? dark : light}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <AppContent />
      </Theme.Provider>
    </SafeAreaProvider>
  );
}
