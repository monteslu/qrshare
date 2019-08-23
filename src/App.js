import React from 'react';
import QRCode from 'qrcode.react';
import rawr from 'rawr';
import transport from 'rawr/transports/worker';
import './App.css';

const SEGMENT_SIZE = 80;
const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 30;

let ready = false;
const rawrPeer = rawr({transport: transport(new Worker('/workers/scan-decoder.js'))});
rawrPeer.notifications.onready(() => {
  console.log('peer ready');
  ready = true;
});
const { detectUrl } = rawrPeer.methods;


let lastScan = Date.now();
let lastQR;
const TIME_BETWEEN_SCANS = 1000 * 10;

function decode (context) {
  if(!ready) {
    return Promise.resolve(null);
  }
  let canvas = context.canvas;
  let width = canvas.width;
  let height = canvas.height;
  let imageData = context.getImageData(0, 0, width, height);
  return detectUrl(width, height, imageData);
};

const styles = {
  qr: {
    margin: '20px',
    maxHeight: '60vh',
    maxWidth: '90vw',
  },
  button: {
    margin: '10px',
    fontSize: '2rem'
  }
}
class QRShare extends React.Component {
  constructor(props) {
    super(props);
    this.vidRef = React.createRef();
    this.canvasRef = React.createRef();
  }

  state = {
    mode: '',
    qrSize: window.innerHeight < window.innerWidth ? window.innerHeight * 0.6 : window.innerWidth * 0.9,
    receiveSegments: {},
    totalReceived: 0,
    expecting: '?'
  };

  handleOrientationListener = () => {
    const qrSize = window.innerHeight < window.innerWidth ? window.innerHeight * 0.9 : window.innerWidth * 0.6;
    this.setState({ qrSize });
  }

  handleShare = () => {
    const inputDialog = document.createElement('input');
    inputDialog.id = 'fileUpload';
    inputDialog.type = "file";
    inputDialog.click();
    inputDialog.onchange = (data) => {
      const selectedFile = data.target.files[0];

      console.log('fileInfo', selectedFile);

      if(selectedFile){
        const reader = new FileReader();

        // Closure to capture the file information.
        reader.onload = (theFile) => {
          const result = theFile.target.result;
          // console.log('file read finished', theFile, result, result.length);
          const segments = [];
          const numSegments = Math.floor(result.length / SEGMENT_SIZE) + (result.length % SEGMENT_SIZE ? 1 : 0);
          console.log('remainder', result.length % SEGMENT_SIZE, 'div', result.length / SEGMENT_SIZE);
          for(let i = 0; i < numSegments; i++) {
            const start = i * SEGMENT_SIZE;
            const seg = result.substring(start, start + SEGMENT_SIZE);
            if(seg) {
              segments.push(seg);
            }
            
          }
          const joined = segments.join('');
          console.log('result  : ', result);
          console.log('segments: ', joined);
          console.log('equal', joined === result);

          this.setState({mode: 'share', segments, current: 0});
          this.intervalId = setInterval(() => {
            let current = this.state.current + 1;
            if(current === segments.length) {
              this.setState({current: 0});
            } else {
              this.setState({current});
            }
            // console.log(this.state.current, 'of', this.state.segments.length);
          }, 150);

        };

        reader.readAsDataURL(selectedFile);
      }

    }
  }

  handleReceive = () => {
    navigator.mediaDevices.getUserMedia({video: true})
    .then((stream) => {
      this.setState({mode: 'receive'});
      const vid = this.vidRef.current;
      vid.srcObject = stream;
      this.stream = stream;

      const cameraCanvas = document.createElement('canvas');

      vid.addEventListener('loadeddata', (e) => {
        cameraCanvas.height = vid.videoHeight;
        cameraCanvas.width = vid.videoWidth;
        vid.height = vid.videoHeight;
        vid.width = vid.videoWidth;
        const ctx = cameraCanvas.getContext('2d');
        const onframe = async () => {
          if(vid.videoWidth > 0) {
            ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight);
            decode(ctx)
            .then((bc) => {
              if(bc) {
                if ((lastQR !== bc.rawValue) || (Date.now() - lastScan > TIME_BETWEEN_SCANS)) {
                  // console.log('found qr', bc.rawValue);
                  let splits = bc.rawValue.split('#');
                  if(splits.length === 3) {
                    const rSegs = this.state.receiveSegments;
                    rSegs['r'+splits[0]] = splits;
                    const expecting = parseInt(splits[1]);
                    const totalReceived = Object.keys(rSegs).length;
                    if(totalReceived === expecting) {
                      //we're done!
                      console.log('done!');
                      console.log(rSegs);
                      const doneSegs = [];
                      for(let i = 0; i < expecting; i++) {
                        doneSegs[i] = rSegs['r' + i][2];
                      }
                      const dataUrl = doneSegs.join('');
                      this.setState({mode: 'done', dataUrl});

                      console.log('dataurl', dataUrl);

                    } else {
                      this.setState({receiveSegments: rSegs, expecting, totalReceived });
                      this.updateCanvas();
                    }
                    
                  }
                }

                lastQR = bc.rawValue;
                lastScan = Date.now();

                requestAnimationFrame(onframe);

              } else if(this.state.mode === 'receive') {
                requestAnimationFrame(onframe);
              }
            });
          }
          
        };

        requestAnimationFrame(onframe);
      });

      vid.play();
      
    });
    
  }

  handleRangeChange = (evt) => {
    console.log('range change', evt.target.value);
    this.setState({current: parseInt(evt.target.value)});
  }

  updateCanvas = () => {
    if(this.canvasRef.current && this.state.expecting) {
      const ctx = this.canvasRef.current.getContext('2d');
      ctx.fillStyle = 'red';
      ctx.lineWidth = 0;
      const pixelWidth = CANVAS_WIDTH / this.state.expecting;
      
      for(let i = 0; i < this.state.expecting; i ++) {
        if(this.state.receiveSegments['r' + i]) {
          ctx.fillStyle = 'red';
        }
        else {
          ctx.fillStyle = 'white';
        }
        ctx.fillRect(pixelWidth * i, 0, pixelWidth, CANVAS_HEIGHT);
      }
    }
  }

  render() {
    let segString;
    if(this.state.mode === 'share' && this.state.segments) {
      segString = `${this.state.current}#${this.state.segments.length}#${this.state.segments[this.state.current]}`;
      // console.log('s c', this.state.current, this.state.segments ? this.state.segments.length : null, segString);
    }
    else if(this.state.mode === 'receive') {
      // console.log('r c', this.state.totalReceived, this.state.expecting, this.state.receiveSegments);
    }
    
    return (
      <div className="App">
        <header className="App-header"> 
         { !this.state.mode ? (
           <div>
            <button onClick={this.handleShare} style={styles.button}>Share</button>
            <button onClick={this.handleReceive} style={styles.button}>Receive</button>
           </div>
         ) : ''}
         { this.state.mode === 'share' ? (
           <div>
           <QRCode
              value={segString}
              style={styles.qrr}
              size={this.state.qrSize}
            /><br/>
            <input type="range" min="0" max={this.state.segments.length - 1} value={this.state.current} step="1" onChange={this.handleRangeChange} style={{margin: '20px'}}></input>
            </div>
         ) : ''}
         <video ref={this.vidRef} muted style={{display: this.state.mode === 'receive' ? '' : 'none', transform: 'rotateY(180deg)'}}></video>
         { this.state.mode === 'receive' ? (
           <div><span style={{color: 'black'}}>{`${this.state.totalReceived} of ${this.state.expecting} `}</span><br/>
           <canvas ref={this.canvasRef} height={CANVAS_HEIGHT} width={CANVAS_WIDTH} style={{border: '1px solid black'}}></canvas>
           </div>
         ) : ''}
         { this.state.mode === 'done' ? (
           <img src={this.state.dataUrl} alt="pieced together"></img>
         ) : ''}
        </header>
      </div>
    );
  }
}


export default QRShare;
