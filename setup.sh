yarn
rm -rf ./.haxelib
yarn setup-deps
haxelib install lib.hxml --always
cp ./overrides/genes/src/genes/Register.hx ./.haxelib/genes/0,4,12/src/genes/Register.hx
cd ./.haxelib/haxpression
find . -name '*.hx' -type f -exec sed -i 's/operator/operator_/g' {} \;