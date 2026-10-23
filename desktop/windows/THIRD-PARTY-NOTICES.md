# Third-party notices — Windows desktop companion

## dwebp.exe (libwebp)

- File: `desktop/windows/tools/dwebp.exe`
- Version: libwebp 1.6.0, Windows x64 official release package
- Source: <https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0-windows-x64.zip>
- SHA-256: `17c1488bf84b7834e9aa908bb40afd0be2e55d57567d210e96336c56bb6ae993`
- Project: <https://chromium.googlesource.com/webm/libwebp>
- License: BSD 3-Clause, see `LICENSE.webp`; patent grant:
  <https://www.webmproject.org/license/additional/>

`dwebp.exe` is unmodified and is executed only to convert a pet's WebP
spritesheet into a PNG cache under `%USERPROFILE%\.dsh\pets\.petdex\cache`.
It is not loaded as a library and receives no network access.

The binary is distributed by the WebM Project; it is not covered by the
dsh-petpal MIT license.
