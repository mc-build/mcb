package mcl.error;

class ParserError extends McbError {
	public function new(message:String) {
		super('Parser Error:\n\t$message', []);
	}
}
