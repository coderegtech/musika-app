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
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { Track, seconds } from "../models";
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
        <Cover
          uri={track.thumbnail}
          size={width}
          style={{ borderRadius: 11 }}
        />
        {downloaded && (
          <View
            style={{
              position: "absolute",
              right: 10,
              bottom: 10,
              backgroundColor: c.lime,
              borderRadius: 20,
              padding: 6,
            }}
          >
            <Icon name="check" size={13} color="#243B30" />
          </View>
        )}
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
}: {
  track: Track;
  onPress: () => void;
  index?: number;
  action?: React.ReactNode;
  subtitle?: string;
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
        <Cover uri={track.thumbnail} size={48} />
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
