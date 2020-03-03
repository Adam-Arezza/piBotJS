const cv = require('opencv4nodejs')
const vCap = new cv.VideoCapture(0)

// loop through the capture
while (true) {
  let _,frame = vCap.read();
  // loop back to start on end of stream reached
  cv.imshow('window',frame)
  const key = cv.waitKey(30);
  if (key == 27) {
      break
  } 
}