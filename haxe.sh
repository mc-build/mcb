BIN="$1"
shift
# check if tools/haxe/haxe exists
# if it does use that
# otherwise defer to haxe in the path
# this is to allow for a local haxe install
echo CWD: $(pwd)

if [ -f ./tools/haxe/$BIN ]; then
  HAXE="./tools/haxe/$BIN"
else
  HAXE="$BIN"
fi
echo HAXE: $HAXE
$HAXE $@