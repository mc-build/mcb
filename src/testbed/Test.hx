package testbed;

typedef SourceFile = {
	var path:String;
	var content:String;
}

typedef Test = {
	var sources:Array<SourceFile>;
	var name:String;
	var expectedResult:Null<Map<Int, String>>;
	var resultPath:String;
	var configPath:Null<String>;
}
