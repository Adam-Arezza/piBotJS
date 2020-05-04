const imu = require('mpu9250')



const ACCEL_CALIBRATION =  { offset:
    { x: 0.0201129150390625,
      y: 0.0022226969401041665,
      z: 0.009766845703125 },
   scale:
    { x: [ -0.9738680013020833, 1.0276448567708334 ],
      y: [ -0.99871337890625, 1.0069742838541667 ],
      z: [ -0.9872347005208333, 1.03660888671875,  ] } }

let refresh = setInterval(getData, 100)
const gryoOffsets = {
    x:1.342473282, 
    y: -1.471261069,
    z: 1.35940458
}

function getData() {
    let vals = mpu.getGyro()
    for(let i = 0; i < vals.length; i++) {
        vals[i] = Number(vals[i].toFixed(4))
    }

    console.log(vals)
    // let vals = mpu.getAccel()
    // for(let i = 0; i < vals.length; i++) {
    //         vals[i] = Number((vals[i] + gryoOffsets[i]).toFixed(4))
    //     }
    // console.log(vals)
}

const mpu = new imu({upMagneto: true, scaleValues:true, accelCalibration: ACCEL_CALIBRATION, gyroBiasOffset: gryoOffsets})
mpu.initialize()