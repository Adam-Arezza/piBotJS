const imu = require('mpu9250')

const ACCEL_CALIBRATION =  { offset:
    { x: 0.0201129150390625,
      y: 0.0022226969401041665,
      z: 0.009766845703125 },
   scale:
    { x: [ -0.9738680013020833, 1.0276448567708334 ],
      y: [ -0.99871337890625, 1.0069742838541667 ],
      z: [ -0.9872347005208333, 1.03660888671875,  ] } }

let refresh = setInterval(getData, 300)
// const gryoOffsets = {
//     x:1.342473282, 
//     y: -1.471261069,
//     z: 1.35940458
// }

const GYRO_OFFSET = { x: 1.5022595419847335,
    y: -1.490045801526719,
    z: 1.2073740458015256 }

function getData() {
    let vals = mpu.getGyro()
    for(let i = 0; i < vals.length; i++) {
        vals[i] = Number(vals[i].toFixed(4))
    }

    console.log(vals)
    // let vals = mpu.getAccel()
    // for(let i = 0; i < vals.length; i++) {
    //         vals[i] = Number((vals[i]).toFixed(3))
    //     }
    // console.log(vals)
}

const mpu = new imu({device:'/dev/i2c-4', scaleValues: true, gyroBiasOffset: GYRO_OFFSET })
mpu.initialize()
console.log(mpu.initialize())
// console.log(mpu.debug)