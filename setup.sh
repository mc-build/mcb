npm i
rm -rf ./.haxelib
npm run setup-deps
haxelib install lib.hxml --always
# cp ./overrides/genes/src/genes/Register.hx ./.haxelib/genes/0,4,13/src/genes/Register.hx
cd ./.haxelib/haxpression
find . -name '*.hx' -type f -exec sed -i 's/operator/operator_/g' {} \;