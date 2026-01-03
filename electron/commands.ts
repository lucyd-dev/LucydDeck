enum Command {
	Version = 0x01,
	TriggerAction = 0x02,
	ConfigUpload = 0x03,
	ImageUpload = 0x04,
	FileChunk = 0x05,
	FileEnd = 0x06,
	Page = 0x10,
	PageNext = 0x11,
	PagePrevious = 0x12,
	Ack = 0x7f,
	Error = 0x80,
}

export { Command };
