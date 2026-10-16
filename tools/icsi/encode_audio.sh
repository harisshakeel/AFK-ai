#!/bin/sh
# Re-encode an ICSI mixed-headset WAV (16 kHz mono PCM) to AAC for streaming.
# Uses macOS's built-in afconvert; no third-party tools. An hour comes out at
# roughly 16 MB, well under Supabase Free's 50 MB per-file limit.
#
# Usage: tools/icsi/encode_audio.sh <in.wav> <out.m4a>
set -eu
in="$1"; out="$2"
afconvert -f m4af -d aac -b 64000 -s 3 "$in" "$out"
afinfo "$out" | grep -E 'estimated duration|bit rate'
