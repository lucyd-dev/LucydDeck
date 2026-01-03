import HID from 'node-hid';
import { SerialPort } from 'serialport';

const VENDOR_ID = 0x303a;
const PRODUCT_ID = 0x1001;

const connect = () => {
	console.log('Connecting to device');
	const device = HID.devices().find(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
	const hid = new HID.HID(device?.path || '');
	console.log(hid.getDeviceInfo().product);

	hid.on('data', (data: Buffer) => {
		console.log(data.toString("utf8").replace(/\0/g, ""));
	});

	console.log(device);
}

const serial = () => {
	const port = new SerialPort({
		path: 'COM3',
		baudRate: 115200
	});

	port.on('open', () => {
		console.log('Port opened');
	});

	port.on('data', (data: Buffer) => {
		console.log(data.toString());
	});
}

export { connect, serial };
