#!/bin/sh
# ตรวจว่า GmatConsole และ plugin ทุกตัวหาไลบรารีครบ (รันใน stage runtime ตอน build)
# usage: gmat-check-libs.sh <GMAT root> <จำนวนไฟล์ขั้นต่ำ>
#
# - glob ที่ไม่ตรงไฟล์ใดเลยทำให้ล้ม (ไม่ผ่านแบบเงียบ ๆ เมื่อโครงโฟลเดอร์ของ tarball เปลี่ยน) และต้องตรวจอย่างน้อย <จำนวนไฟล์ขั้นต่ำ> ไฟล์
# - plugin ไม่มี RPATH ไปหา libGmatBase/libGmatUtil เพราะ GmatConsole โหลดไว้ก่อนแล้วตอน dlopen จึงตรวจด้วย LD_LIBRARY_PATH ของ bin/ และ plugins/
set -eu

root="$1"
min="$2"
n=0
missing=""
for f in "$root"/bin/GmatConsole-* "$root"/bin/*.so* "$root"/plugins/*.so.* "$root"/plugins/*/*.so.*; do
  if [ ! -e "$f" ]; then
    echo "gmat-check-libs: pattern ไม่ตรงไฟล์ใดเลย: $f" >&2
    exit 1
  fi
  out="$(LD_LIBRARY_PATH="$root/bin:$root/plugins" ldd "$f")" || { echo "gmat-check-libs: ldd ล้มกับ $f" >&2; exit 1; }
  nf="$(printf '%s\n' "$out" | grep 'not found' || true)"
  if [ -n "$nf" ]; then
    missing="$missing$(printf '%s\n' "$nf" | sed "s@^@$f: @")
"
  fi
  n=$((n + 1))
done

if [ -n "$missing" ]; then
  printf 'gmat-check-libs: ไลบรารีที่หาไม่พบ\n%s' "$missing" >&2
  exit 1
fi
if [ "$n" -lt "$min" ]; then
  echo "gmat-check-libs: ตรวจได้ $n ไฟล์ น้อยกว่าขั้นต่ำ $min (ไฟล์หายไปจาก GMAT?)" >&2
  exit 1
fi
echo "gmat-check-libs: ตรวจ $n ไฟล์ ไลบรารีครบ"
