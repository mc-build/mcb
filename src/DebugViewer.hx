package;

import haxe.macro.Type.Ref;
import js.html.Document;
import js.Browser;
import mcl.AstNode;
import haxe.Unserializer;
import haxe.Resource;
import mcl.Tokenizer.Token;

typedef MetaFile = {f:String, t:Array<Token>, a:Array<mcl.AstNode>, s:String};

class DebugViewer {
	static function createViewer(file:MetaFile) {
		var root = Browser.document.querySelector("#viewer");
		root.innerHTML = "";

		// create a 2 column layout with a textarea on the right and 2 cells on the left
		var table = Browser.document.createElement("div");
		table.style.display = "flex";
		table.style.flexDirection = "row";
		table.style.flexWrap = "nowrap";
		table.style.width = "100%";
		var tr = Browser.document.createElement("div");
		var td = Browser.document.createElement("div");
		var td2 = Browser.document.createElement("div");
		td2.style.width = "100%";
		td.style.width = "100%";
		var textarea = Browser.document.createElement("pre");
		var code = Browser.document.createElement("code");
		code.appendChild(textarea);
		table.style.width = "100%";
		textarea.innerText = file.s;
		td2.appendChild(code);
		tr.appendChild(td);
		// create a table with 2 rows
		table.appendChild(td2);
		table.appendChild(tr);
		root.appendChild(table);
		// div
		var tokensList = Browser.document.createElement("div");
		var list = Browser.document.createElement("ul");
		for (token in file.t) {
			var span = Browser.document.createElement("li");
			switch (token) {
				case Literal(v, pos):
					span.appendChild(Browser.document.createTextNode("Literal('" + v + "') at " + pos.line + ":" + pos.col));
				case BracketOpen(pos, data):
					span.appendChild(Browser.document.createTextNode("BracketOpen(" + (data == null ? 'null' : "'" + data + "'") + ") at " + pos.line + ":"
						+ pos.col));
				case BracketClose(pos):
					span.appendChild(Browser.document.createTextNode("BracketClose at " + pos.line + ":" + pos.col));
			}
			list.appendChild(span);
		}
		tokensList.appendChild(list);
		tr.appendChild(tokensList);
	}

	static function createFileList(files:Array<MetaFile>) {
		var ul = Browser.document.createElement("ul");
		for (file in files) {
			var li = Browser.document.createElement("li");
			var button = Browser.document.createElement("button");
			button.appendChild(Browser.document.createTextNode(file.f));
			button.addEventListener("click", () -> createViewer(file));
			li.appendChild(button);

			ul.appendChild(li);
		}
		Browser.document.querySelector("#files").appendChild(ul);
	}

	static function main() {
		var x = Literal("", {file: "", line: 0, col: 0});
		var y = AstNode.Raw({file: "", line: 0, col: 0}, "foo");
		var data = Resource.getString("data");
		var deserializer = new Unserializer(data);
		var objects:Map<String, Any> = new Map();

		while (true) {
			var data:Null<MetaFile> = deserializer.unserialize();
			if (data == null)
				break;
			objects.set(data.f, cast data);
		}
		createFileList([for (v in objects) v]);
	}
}
