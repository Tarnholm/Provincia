#pragma description Rome: Total War Remastered save file (.sav) — known header + section registry
#pragma endian little

import std.io;
import std.mem;
import std.string;

// ─── Header ──────────────────────────────────────────────────────────────
// All offsets in bytes from start of file. Little-endian.

struct Header {
    u32  magic;                  // 0x00 — always 0x070a
    u32  campaign_uuid;          // 0x04 — campaign session id

    // 0x08..0x1b = 20 unknown bytes. From existing dig work these contain
    // additional ids / build flags but nothing labeled yet.
    u8   unknown_08_1c[0x1c - 0x08];

    u32  campaign_type_flag;     // 0x1c — 0x20004 imperial / 0x20204 alexander
    u32  save_version;           // 0x20 — 7 for RR

    // 12-byte content hash split as 3 u32 sub-hashes:
    //   +0x24 = campaign/scenario hash
    //   +0x28 = mod hash
    //   +0x2c = setup variant hash
    u32  hash_campaign;          // 0x24
    u32  hash_mod;               // 0x28
    u32  hash_variant;           // 0x2c

    u32  session_timestamp;      // 0x30 — unix-style epoch
    u8   unknown_34_3a[0x3a - 0x34];

    u16  campaign_name_len;      // 0x3a — UTF-16 character count
    char16 campaign_name[campaign_name_len];
};

Header header @ 0x00;

// nameEnd is the file offset right after the campaign name's UTF-16 chars.
fn nameEnd() {
    return 0x3c + header.campaign_name_len * 2;
};

// ─── Faction discovered-by-player bitmask (right after the name) ──────────
// Sentinel: 3 bytes 9c c7 06 at nameEnd+16. Followed by u8 byte-count, then
// the bitmask bytes themselves.

struct DiscoveredBitmask {
    u8   pad[16];                 // unknown padding from name_end
    u8   sentinel[3];             // expect 9C C7 06
    u8   byte_count;              // number of bitmask bytes
    u8   bits[byte_count];        // little-endian bit array
};

DiscoveredBitmask discovered @ nameEnd();

// ─── Big unknown gap up through the section-registry hunt zone ────────────
// The mod display name / hash / path strings are scattered in 0x326d..0x4400.
// The action-counter u32 lives at 0x43f8.
//
// Below we declare ImHex placements for each pstr16 (UTF-16 LE) that the
// app reads, plus the unknown bookend.

struct Pstr16Utf16 {
    u16  char_count;
    char16 chars[char_count];
};

// These three are conditional — many saves miss one or more. We still
// declare them; ImHex will simply render whatever is at that offset.

Pstr16Utf16 mod_display_name @ 0x326d;
Pstr16Utf16 mod_content_hash @ 0x32c2;
Pstr16Utf16 mod_path        @ 0x43fc;

u32 action_counter            @ 0x43f8;

// ─── Section type registry ────────────────────────────────────────────────
// Located dynamically. Each entry: u32 count then a NUL-terminated ASCII
// uppercase name. To represent in hexpat we declare a single anchored entry
// then walk the rest as a flat array using a heuristic terminator.
//
// Empirically the registry sits at 0x566 in vanilla RR and 0x3310 in RIS.
// We try both as separate placements.

struct RegistryEntry {
    u32  count;
    char name[];                  // NUL-terminated
};

RegistryEntry registry_at_566[106]  @ 0x566;
RegistryEntry registry_at_3310[106] @ 0x3310;
