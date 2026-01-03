import { HIDAsync, devicesAsync } from 'node-hid';
import { Buffer } from 'buffer';
import crc from 'crc';
import { Command } from './commands';

const VENDOR_ID = 0x303a; // Replace with your ESP32 VID
const PRODUCT_ID = 0x1001; // Replace with your PID
const USAGE_PAGE = 0xff00;
const USAGE = 0x01;
const REPORT_ID = 0x06;
const PACKET_SIZE = 64;
const CRC_SIZE = 4;
const HEADER_SIZE = 3;
const PACKET_DATA_SIZE = PACKET_SIZE - HEADER_SIZE - CRC_SIZE;


export class USBComm {
	private device!: HIDAsync;
	private ackResolver: (() => void) | null = null;
	private ackTimeout: NodeJS.Timeout | null = null;
	private abortCurrentFile = false;

	async connect() {
		const devices = await devicesAsync();
		const deviceInfo = devices.find(
			(device) =>
				device.vendorId === VENDOR_ID &&
				device.productId === PRODUCT_ID &&
				device.usagePage === USAGE_PAGE &&
				device.usage === USAGE
		);
		if (!deviceInfo) {
			throw new Error('Device not found');
		}
		this.device = await HIDAsync.open(deviceInfo.path!);
		console.log('Connected to device', await this.device.getDeviceInfo());
		this.device.on('data', this.onData.bind(this));
		this.device.on('error', (err) => console.error(`USB error: ${err}`));
	}

	private onData(data: Buffer) {
		const len = data[0];
		const cmd = data[1];
		// console.log('Received data', data.toString('hex'), len);

		const crcValue = crc.crc32(data.slice(1, PACKET_SIZE - 4));
		const crcValueFromPacket = data.readUInt32LE(PACKET_SIZE - 4);
		if (crcValue !== crcValueFromPacket) {
			console.error(`CRC mismatch ${crcValue.toString(16)} ${crcValueFromPacket.toString(16)}`);
			return;
		}

		const payload = data.slice(2, PACKET_SIZE - 4);
		const payloadStr = payload.toString().trim();
		switch (cmd) {
			case Command.Version:
				console.log(`Version: ${payloadStr}`);
				break;
			case Command.TriggerAction:
				console.log(`Trigger action: ${payloadStr}`);
				break;
			case Command.Ack:
				// console.log('ACK received');
				this.handleAck();
				break;
			case Command.Error:
				console.error(`Error from device: "${payloadStr}"`);
				this.handleError(payloadStr);
				this.abortCurrentFile = true;
				this.handleAck();
				break;
			default:
				console.log(`Unknown command: ${cmd} data: ${data.toString('hex')}`);
		}
	}

	private async handleAck() {
		if (this.ackTimeout) {
			clearTimeout(this.ackTimeout);
			this.ackTimeout = null;
		}
		if (this.ackResolver) {
			this.ackResolver();
			this.ackResolver = null;
		}
	}

	private waitForAck(timeoutMs = 2000): Promise<void> {
		if (this.ackResolver) throw new Error('Already waiting for ACK');
		return new Promise<void>((resolve, reject) => {
			this.ackResolver = resolve;
			this.ackTimeout = setTimeout(() => {
				this.ackResolver = null;
				reject(new Error('ACK timeout'));
			}, timeoutMs);
		});
	}

	private handleError(payloadStr: string) {
		switch (payloadStr) {
			case 'crc_error':
				console.error("CRC error");
				break;
			default:
				console.error(`Unknown error: "${payloadStr}"`);
		}
	}

	async uploadFile(cmd: Command.ImageUpload | Command.ConfigUpload, fileName: string, fileData: Buffer) {
		this.abortCurrentFile = false;


		const openPacket = this.createPacket(cmd, Buffer.from(fileName));
		await this.sendPacket(openPacket);
		await this.waitForAck();

		for (let i = 0; i < fileData.length; i += PACKET_DATA_SIZE) {
			if (this.abortCurrentFile) {
				console.warn('Aborting file upload due to device error.');
				return;
			}
			const dataChunk = fileData.slice(i, i + PACKET_DATA_SIZE);
			const chunkPacket = this.createPacket(Command.FileChunk, dataChunk);
			await this.sendPacket(chunkPacket);
			await this.waitForAck();
		}

		const endPacket = this.createPacket(Command.FileEnd, Buffer.alloc(0));
		await this.sendPacket(endPacket);
		await this.waitForAck();

		if (!this.abortCurrentFile) {
			console.log(`File "${fileName}" sent successfully!`);
		}
	}

	private async sendPacket(packet: Buffer) {
		await this.device.write(packet);
	}

	createPacket(cmd: Command, data: Buffer): Buffer {
		const packet = Buffer.alloc(PACKET_SIZE);

		packet[0] = REPORT_ID;
		packet[1] = cmd;
		packet[2] = data.length;
		data.copy(packet, 3);

		const crcValue = crc.crc32(packet.slice(1, PACKET_SIZE - CRC_SIZE));
		packet.writeUInt32LE(crcValue, PACKET_SIZE - CRC_SIZE);

		return packet;
	}

	async sendPage(page: number) {
		const buffer = Buffer.alloc(1);
		buffer.writeUInt8(page, 0);
		const packet = this.createPacket(Command.Page, buffer);
		await this.sendPacket(packet);
	}
}
