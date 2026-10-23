#!/bin/sh
# Builds desktop/windows/PetPal.exe next to this script.
#
# Needs a .NET SDK (6 or newer). The executable itself targets .NET Framework
# 4.8, which ships with Windows 10 (1903+) and Windows 11, so end users do not
# need this SDK. The checked-in PetPal.exe is produced by this script.
#
#   bash desktop/windows/build.sh
#   DOTNET=/path/to/dotnet bash desktop/windows/build.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DOTNET=${DOTNET:-dotnet}

if ! command -v "$DOTNET" >/dev/null 2>&1; then
  echo "error: '$DOTNET' not found; install the .NET SDK 6+ to rebuild PetPal.exe" >&2
  exit 1
fi

OUT="$HERE/.build"
rm -rf "$OUT"
"$DOTNET" build "$HERE/PetPal.csproj" -c Release -o "$OUT" -nologo -v:minimal

cp "$OUT/PetPal.exe" "$HERE/PetPal.exe"
if [ -f "$OUT/PetPal.exe.config" ]; then
  cp "$OUT/PetPal.exe.config" "$HERE/PetPal.exe.config"
fi

echo "built $HERE/PetPal.exe"
