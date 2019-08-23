importScripts('a.out.js');
importScripts('rawr.bundle.js');


const rawrPeer = rawr({transport: rawr.transports.worker()});

self.rawrPeer = rawrPeer;


let wasmApi;
let wasmResult;

Module.onRuntimeInitialized = async _ => {

  rawrPeer.notifiers.ready();

  // wrap all C functions using cwrap. Note that we have to provide crwap with the function signature.
	wasmApi = {
		scan_image: Module.cwrap('scan_image', '', ['number', 'number', 'number']),
		create_buffer: Module.cwrap('create_buffer', 'number', ['number', 'number']),
		destroy_buffer: Module.cwrap('destroy_buffer', '', ['number']),
  };
  
  // set the function that should be called whenever a barcode is detected
	Module['processResult'] = (symbol, data, polygon) => {
		wasmResult = {
      rawValue: data,
      polygon
    };
	}

};



// Use the native API's
async function nativeDetector (width, height, imageData) {
  try {
    // console.log('trying native');
    let barcodeDetector = new BarcodeDetector();
    let barcodes = await barcodeDetector.detect(imageData);
    // return the first barcode.
    if (barcodes.length > 0) {
      const code = barcodes[0];
      return code;
    }
    return null;
  } catch(err) {
    detector = workerDetector;
    return null;
  }
};

// Use the polyfil
async function workerDetector (width, height, imageData) {
  try {
    // console.log('trying wasm');
    wasmResult = null;

    const d = imageData.data;

    // convert the image data to grayscale 
		const grayData = []
		for (var i = 0, j = 0; i < d.length; i += 4, j++) {
			grayData[j] = (d[i] * 66 + d[i + 1] * 129 + d[i + 2] * 25 + 4096) >> 8;
		}

		// put the data into the allocated buffer
		const p = wasmApi.create_buffer(width, height);
    Module.HEAP8.set(grayData, p);
    //Module.HEAP8.set(d, p);

		// call the scanner function
		wasmApi.scan_image(p, width, height)

		// clean up (this is not really necessary in this example, but is used to demonstrate how you can manage Wasm heap memory from the js environment)
    wasmApi.destroy_buffer(p);
    return wasmResult;
  } catch (err) {
    // the library throws an excpetion when there are no qrcodes.
    return null;
  }
}


let detector;
if('BarcodeDetector' in self) {
  // detector = nativeDetector;
  detector = workerDetector
} else {
  detector = workerDetector;
}

async function detectUrl (width, height, imageData) {
  return await detector(width, height, imageData);
};

rawrPeer.addHandler('detectUrl', detectUrl);
