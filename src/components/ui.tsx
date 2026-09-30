import React, { createContext, useContext } from "react";
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ImageStyle,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { Track, seconds, artwork, ACTIVE_STATES } from "../models";
import { useStore } from "../store";
export const light = {
  paper: "#F6F5EF",
  surface: "#FFFFFF",
  ink: "#243B30",
  muted: "#858A7E",
  line: "#E5E7DD",
  soft: "#ECEEE5",
  lime: "#DDF48C",
  forest: "#263F32",
};
export const dark = {
  paper: "#17241D",
  surface: "#213228",
  ink: "#F0F2E9",
  muted: "#A1AD9E",
  line: "#35463B",
  soft: "#2B3D31",
  lime: "#DDF48C",
  forest: "#263F32",
};
export const Theme = createContext(light);
export const useColors = () => useContext(Theme);
export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: React.ComponentProps<typeof Feather>["name"];
  size?: number;
  color?: string;
  style?: any;
}) {
  const c = useColors();
  return (
    <Feather name={name} size={size} color={color || c.ink} style={style} />
  );
}
export function Label({
  children,
  style,
  muted = false,
  serif = false,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: TextStyle | TextStyle[];
  muted?: boolean;
  serif?: boolean;
  numberOfLines?: number;
}) {
  const c = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          color: muted ? c.muted : c.ink,
          fontSize: 14,
          fontFamily: serif ? "Georgia" : undefined,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  icon,
  secondary = false,
  small = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Icon>["name"];
  secondary?: boolean;
  small?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        {
          flexDirection: "row",
          gap: 9,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: small ? 15 : 22,
          paddingVertical: small ? 10 : 14,
          borderRadius: 30,
          backgroundColor: secondary ? c.soft : c.lime,
          opacity: disabled ? 0.45 : pressed ? 0.7 : hovered ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon && (
        <Icon
          name={icon}
          size={small ? 15 : 17}
          color={secondary ? c.ink : "#243B30"}
        />
      )}
      <Text
        style={{
          fontSize: small ? 12 : 14,
          fontWeight: "600",
          color: secondary ? c.ink : "#243B30",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  name,
  onPress,
  label,
  color,
  size = 20,
  style,
}: {
  name: React.ComponentProps<typeof Icon>["name"];
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  style?: ImageStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ hovered, pressed }: any) => [
        {
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 22,
          opacity: pressed ? 0.5 : hovered ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Icon name={name} color={color} size={size} />
    </Pressable>
  );
}
export function Pill({
  title,
  active,
  onPress,
}: {
  title: string;
  active?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: 19,
        paddingVertical: 10,
        borderRadius: 30,
        backgroundColor: active ? c.forest : "transparent",
        borderWidth: 1,
        borderColor: active ? c.forest : c.line,
      }}
    >
      <Text
        style={{
          color: active ? "#fff" : c.ink,
          fontSize: 12,
          fontWeight: active ? "600" : "400",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Cover({
  uri,
  size = 56,
  style,
}: {
  uri: string;
  size?: number;
  style?: ImageStyle;
}) {
  return (
    <Image
      source={{ uri }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: 8,
          backgroundColor: "#CBD4C0",
        },
        style,
      ]}
    />
  );
}
/** State-aware download control: Download, live progress, or Downloaded ✓. */
export function DownloadButton({
  track,
  size = 34,
}: {
  track: Track;
  size?: number;
}) {
  const c = useColors();
  const downloaded = useStore((s) => s.library.some((t) => t.id === track.id));
  const job = useStore((s) =>
    s.downloads.find(
      (j) => j.track.id === track.id && ACTIVE_STATES.includes(j.state),
    ),
  );
  const label = downloaded
    ? `Downloaded ✓ ${track.title}`
    : job
      ? `Downloading ${track.title}, ${Math.round(job.progress)}%`
      : `Download ${track.title}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => useStore.getState().quickDownload(track)}
      style={({ pressed }: any) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: downloaded ? c.lime : "#1B302AAA",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {job ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Icon
          name={downloaded ? "check" : "download"}
          size={size * 0.45}
          color={downloaded ? "#243B30" : "#fff"}
        />
      )}
    </Pressable>
  );
}
export function MenuButton({
  track,
  color,
  style,
  onMenu,
}: {
  track: Track;
  color?: string;
  style?: ImageStyle;
  onMenu?: (track: Track) => void;
}) {
  return (
    <IconButton
      name="more-vertical"
      size={18}
      color={color}
      label={`More options for ${track.title}`}
      onPress={() =>
        onMenu ? onMenu(track) : useStore.getState().openActions(track)
      }
      style={style}
    />
  );
}
export function TrackCard({
  track,
  onPress,
  width,
}: {
  track: Track;
  onPress: () => void;
  width: number;
}) {
  const downloaded = useStore((s) => s.library.some((t) => t.id === track.id));
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${track.artist}${downloaded ? ", downloaded" : ""}`}
      onPress={onPress}
      style={({ hovered }: any) => ({ width, opacity: hovered ? 0.88 : 1 })}
    >
      <View style={{ position: "relative" }}>
        <Cover uri={artwork(track)} size={width} style={{ borderRadius: 11 }} />
        <View style={{ position: "absolute", right: 8, bottom: 8 }}>
          <DownloadButton track={track} />
        </View>
        <View
          style={{
            position: "absolute",
            right: 4,
            top: 4,
            backgroundColor: "#1B302A77",
            borderRadius: 20,
          }}
        >
          <MenuButton track={track} color="#fff" />
        </View>
        <View
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            backgroundColor: "#1B302A77",
            borderRadius: 4,
            paddingHorizontal: 6,
            paddingVertical: 3,
          }}
        >
          <Text style={{ color: "white", fontSize: 10 }}>
            {seconds(track.duration)}
          </Text>
        </View>
      </View>
      <Label
        numberOfLines={1}
        style={{ fontSize: 14, fontWeight: "600", marginTop: 12 }}
      >
        {track.title}
      </Label>
      <Label muted numberOfLines={1} style={{ fontSize: 12, marginTop: 5 }}>
        {downloaded ? "Downloaded ✓ · " : ""}
        {track.artist}
      </Label>
    </Pressable>
  );
}
export function TrackRow({
  track,
  onPress,
  index,
  action,
  subtitle,
  menu = true,
  onMenu,
}: {
  track: Track;
  onPress: () => void;
  index?: number;
  action?: React.ReactNode;
  subtitle?: string;
  /** Show the ⋮ options menu (Copy Link, Add to Playlist, ...). Off inside modals that cannot stack sheets. */
  menu?: boolean;
  /** Override what ⋮ does, e.g. to close a surrounding sheet before the menu opens. */
  onMenu?: (track: Track) => void;
}) {
  const c = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: c.line,
      }}
    >
      {index !== undefined && (
        <Label muted style={{ width: 18, fontSize: 12 }}>
          {String(index + 1).padStart(2, "0")}
        </Label>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${track.title}`}
        onPress={onPress}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 14 }}
      >
        <Cover uri={artwork(track)} size={48} />
        <View style={{ flex: 1, gap: 5 }}>
          <Label numberOfLines={1} style={{ fontWeight: "600", fontSize: 13 }}>
            {track.title}
          </Label>
          <Label muted numberOfLines={1} style={{ fontSize: 12 }}>
            {subtitle || track.artist}
          </Label>
        </View>
        <Label muted style={{ fontSize: 12 }}>
          {seconds(track.duration)}
        </Label>
      </Pressable>
      {action}
      {menu && <MenuButton track={track} onMenu={onMenu} />}
    </View>
  );
}
export function Section({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Label style={{ fontSize: 21, fontWeight: "600", letterSpacing: -0.7 }}>
          {title}
        </Label>
        {subtitle && (
          <Label muted style={{ fontSize: 12, marginTop: 6 }}>
            {subtitle}
          </Label>
        )}
      </View>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={{
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            paddingVertical: 8,
          }}
        >
          <Label style={{ fontSize: 12, fontWeight: "600" }}>{action}</Label>
          <Icon name="arrow-up-right" size={15} />
        </Pressable>
      )}
    </View>
  );
}
export function Empty({
  icon = "music",
  title,
  body,
  action,
  onAction,
}: {
  icon?: React.ComponentProps<typeof Icon>["name"];
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  const c = useColors();
  return (
    <View
      style={{
        padding: 38,
        alignItems: "center",
        gap: 16,
        backgroundColor: c.soft,
        borderRadius: 20,
      }}
    >
      <Icon name={icon} size={32} />
      <Label style={{ fontSize: 21, fontWeight: "600", textAlign: "center" }}>
        {title}
      </Label>
      <Label
        muted
        style={{ lineHeight: 22, textAlign: "center", maxWidth: 400 }}
      >
        {body}
      </Label>
      {action && onAction && <Button title={action} onPress={onAction} />}
    </View>
  );
}
export function Loading() {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 18, paddingVertical: 20 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flex: 1, gap: 12 }}>
          <View
            style={{
              aspectRatio: 1,
              backgroundColor: c.soft,
              borderRadius: 12,
            }}
          />
          <View
            style={{
              height: 14,
              width: "75%",
              backgroundColor: c.soft,
              borderRadius: 4,
            }}
          />
          <View
            style={{
              height: 10,
              width: "50%",
              backgroundColor: c.soft,
              borderRadius: 4,
            }}
          />
        </View>
      ))}
    </View>
  );
}
export function Sheet({
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
