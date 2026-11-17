#!/bin/sh
# ทำ GMAT Linux ที่แตกจาก tarball ทางการให้รัน GmatConsole แบบ headless และเล็กลง (รันตอน build image เท่านั้น)
# usage: gmat-headless.sh <GMAT root>   (โฟลเดอร์ที่มี bin/ data/ plugins/)
#
# - comment out plugin ที่ต้องมี GUI (OpenFrames/OSG/wxWidgets) หรือ interpreter ภายนอก (Python, MATLAB) ใน bin/gmat_startup_file.txt
#   GmatConsole จึงไม่ dlopen ไลบรารีกราฟิกและไม่ต้องมี DISPLAY, X11 หรือ Xvfb
# - ลบสิ่งที่ engine ไม่ใช้: GUI (GMAT-R2026a, lib/ ของ wxWidgets/OSG/OpenFrames, osg*), เอกสาร, ตัวอย่าง, gmatpy, Java/MATLAB API,
#   libCSALT (ต้องมี SNOPT ที่ไม่แจกมาด้วย)
# - คง data/ ทั้งหมด (EOP, leap second, SPICE kernel ฯลฯ ที่ startup file อ้าง), plugin คำนวณ, License.txt และ README.txt
set -eu

root="$1"
startup="$root/bin/gmat_startup_file.txt"
[ -x "$root/bin/GmatConsole" ] || { echo "gmat-headless: ไม่พบ $root/bin/GmatConsole" >&2; exit 1; }
[ -f "$startup" ] || { echo "gmat-headless: ไม่พบ $startup" >&2; exit 1; }

DISABLED='OpenFramesInterface|OVtoOFI|PythonInterface_py[0-9]+|MatlabInterface|ExternalForceModel_py[0-9]+'

sed -i -E "s@^([[:space:]]*PLUGIN[[:space:]]*=[[:space:]]*\.\./plugins/lib($DISABLED)[[:space:]]*)\$@# [docker: headless] \1@" "$startup"
if grep -E "^[[:space:]]*PLUGIN[[:space:]]*=.*lib($DISABLED)" "$startup"; then
  echo "gmat-headless: ยังมี plugin GUI/interpreter ที่ไม่ได้ปิดใน $startup" >&2
  exit 1
fi
# plugin ที่เหลือต้องมีไฟล์จริงทุกตัว (กันลบผิด)
grep -E '^[[:space:]]*PLUGIN[[:space:]]*=' "$startup" | sed -E 's@^[^=]*=[[:space:]]*\.\./@@; s@[[:space:]]*$@@' | while read -r rel; do
  [ -e "$root/$rel.so" ] || { echo "gmat-headless: plugin $rel.so ไม่มีใน tarball" >&2; exit 1; }
done

rm -rf "$root/docs" "$root/samples" "$root/api" "$root/matlab" "$root/extras" "$root/utilities" "$root/lib" \
       "$root/bin/gmatpy" "$root/README_OpenFramesInterface.txt"
# libCSALT (optimal control) ต้องมี SNOPT ที่เป็นไลบรารีเชิงพาณิชย์ซึ่งไม่อยู่ใน tarball และไม่มี plugin ใน startup file ใช้
rm -f "$root"/bin/GMAT-R* "$root/bin/GMAT_Beta" "$root"/bin/osg* "$root"/bin/*.jar "$root"/bin/*_java.so "$root"/bin/*.m \
      "$root"/bin/libCSALT.so*
for p in $(echo "$DISABLED" | tr '|' ' '); do
  find "$root/plugins" -maxdepth 1 -regextype posix-extended -regex ".*/lib$p\.so.*" -exec rm -f {} +
done

echo "gmat-headless: plugin ที่ GmatConsole โหลด:"
grep -E '^[[:space:]]*PLUGIN[[:space:]]*=' "$startup"
