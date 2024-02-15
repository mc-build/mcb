package mcl.error;

class LibraryError extends McbError {
	public function new(message:String) {
		super('Library Error:\n\t$message');
	}
}
