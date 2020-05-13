const five = require('johnny-five')
const cors = require('cors')
const express = require('express')
const app = express()
app.use(cors())
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const rpi = require('pi-io')
const cv = require('opencv4nodejs')
const mpu = require('mpu9250')
require('sylvester')
const inquirer = require('inquirer')
const board = new five.Board({
    io: new rpi(),
    repl: false
})

// //initialize video
// const cam = new cv.VideoCapture(0)
// cam.set(cv.CAP_PROP_FRAME_WIDTH, 640)
// cam.set(cv.CAP_PROP_FRAME_HEIGHT, 480)
// const fps = 5

// //emits a video frame at fps times per second to the client
// setInterval(() => {
//     const frame = cam.read()
//     const img = cv.imencode('.jpg', frame).toString('base64')
//     io.emit('videoData', img)
// }, 1000 / fps)

const KP = 40
const KI = 0
const KD = 0
let xGoal = 0
let yGoal = 0
let headingAngle = 0
let count = 0
var reFresh
let dt = 0.04
let goals = []
let completed = []
const GYRO_OFFSET = {
    x: 1.5704427480916021,
    y: -1.4300763358778616,
    z: 1.1701984732824422
}

//robot object holds parameters of the robot
const robotData = {
    deltaTL: 0,
    deltaTR: 0,
    leftTickTotal: 0,
    rightTickTotal: 0,
    posX: 0,
    posY: 0,
    heading: 0,
    headingErr: 0,
    sumErr: 0,
    ultrasonicArray: [0, 0, 0],
    imu: [],
    wheelBase: 0.2286,
    wheelRadius: 0.030,
    rightRPM: 0,
    leftRPM: 0,
    leftDir: 1,
    rightDir: 1
}

//initalize the arm servos
// const piArm = require("./arm")

//set the arduino i2c address
const arduino = 0x08

//initialize an mpu9250 object
const imu = new mpu({ device: '/dev/i2c-4', UpMagneto: false, scaleValues: true, gyroBiasOffset: GYRO_OFFSET })
imu.initialize()

//initialize a new LCD component
const LCD = new five.LCD({
    rows: 4,
    cols: 20,
    controller: "PCF8574T"
})

//get goal coordinates from the user
function getGoal() {
    // return new Promise((resolve, reject) => {
    inquirer.prompt([
        {
            type: 'input',
            name: 'x',
            message: "x?"
        },
        {
            type: 'input',
            name: 'y',
            message: "y?"
        },
        {
            type: 'confirm',
            name: 'another',
            message: 'Add another coordinate?',
            default: false
        }

    ])
        .then((answers) => {
            goals.push([Number(answers.x), Number(answers.y)])
            xGoal = goals[0][0]
            yGoal = goals[0][1]
            headingAngle = Math.atan2(yGoal, xGoal)
            if (answers.another) {
                return getGoal()
            }
            if (!answers.another) {
                // resolve("success")
                console.log("got goals, time to move")
                return start()
            }
        })
        .catch((err) => {
            console.log(err)
            return
        })
}

//sets the refresh interval for the controller
function start() {
    if (goals.length == 0) {
        clearInterval(reFresh)
        return console.log("update stopped")
    }
    console.log(goals)
    console.log("starting navigation")
    reFresh = setInterval(checkGoalReached, (dt * 1000))
}

function stop() {
    clearInterval(reFresh)
    motorCommand(0, 0)
    setTimeout(resetArduino, 200)
    console.log(`Goals: ${goals}`)
    console.log(`Completed: ${completed}`)
    console.log(`Final position X: ${robotData.posX} Y: ${robotData.posY}`)
    console.log(`X position error: ${xGoal - robotData.posX}`)
    console.log(`Y position error: ${yGoal - robotData.posY}`)
    console.log(`heading error: ${robotData.headingErr}`)
    return
}

function checkGoalReached() {
    let maxErr = 0.04
    let xErr = Math.abs(robotData.posX - xGoal)
    let yErr = Math.abs(robotData.posY - yGoal)
    //may need a fix here for stopping threshold
    if (Math.abs(robotData.headingErr) <= 0.06) {
        if (xErr <= maxErr && yErr <= maxErr) {
            // robotData.sumErr = 0
            console.log(1)
            return nextGoal()
        }
        if (Math.abs(xGoal) > 0 && Math.abs(yGoal) > 0) {
            if (robotData.posX > Math.abs(xGoal) && robotData.posY > Math.abs(yGoal)) {
                // robotData.sumErr = 0
                console.log(2)
                return nextGoal()
            }
        }

        if (xGoal == 0 && yGoal != 0 ) {
            if (robotData.posX <= 0 && Math.abs(robotData.posY) >= Math.abs(yGoal)) {
                // robotData.sumErr = 0
                console.log(3)
                return nextGoal()
            }
        }
        if (yGoal == 0 && xGoal != 0) {
            if (robotData.posY <= 0 && Math.abs(robotData.posX) >= Math.abs(xGoal)) {
                // robotData.sumErr = 0
                console.log(4)
                return nextGoal()
            }
        }
        // if (xGoal == 0 && yGoal != 0 ) {
        //     if (robotData.posX <= 0 && yErr < 0.1) {
        //         console.log(3)
        //         return nextGoal()
        //     }
        // }
        // if (yGoal == 0 && xGoal != 0) {
        //     if (robotData.posY <= 0 && xErr < 0.1) {
        //         console.log(4)
        //         return nextGoal()
        //     }
        // }
        if (xGoal == 0 && yGoal == 0) {
            if (robotData.posX <= 0 && robotData.posY <= 0) {
                // robotData.sumErr = 0
                console.log(5)
                return nextGoal()
            }
        }
    }

    return getAllData()
}

function nextGoal() {
    let oldDeltaX = 0
    let oldDeltaY = 0
    let deltaX = 0
    let deltaY = 0
    goals.shift()
    completed.unshift([xGoal, yGoal])
    console.log(completed)
    if (goals.length == 0) {
        return stop()
    }
    if (completed.length == 1) {
        oldDeltaX = completed[0][0]
        oldDeltaY = completed[0][1]
    }
    if (completed.length > 1) {
        oldDeltaX = completed[0][0] - completed[1][0]
        oldDeltaY = completed[0][1] - completed[1][1]
    }
    xGoal = goals[0][0]
    yGoal = goals[0][1]
    deltaX = xGoal - completed[0][0]
    deltaY = yGoal - completed[0][1]
    headingAngle = getNewHeadingGoal([deltaX, deltaY], [oldDeltaX, oldDeltaY])
    return getAllData()
}

//calculates the new heading goal based on the last 2 vectors
function getNewHeadingGoal(v1, v2) {
    let dotProd = v1[0] * v2[0] + v1[1] * v2[1]
    // console.log(dotProd)
    let v1Mag = Math.sqrt(Math.pow(v1[0], 2) + Math.pow(v1[1], 2))
    // console.log(v1Mag)
    let v2Mag = Math.sqrt(Math.pow(v2[0], 2) + Math.pow(v2[1], 2))
    // console.log(v2Mag)
    let newHeading = headingAngle + Math.acos((dotProd) / (v1Mag * v2Mag))
    // newHeading = Math.atan2(Math.sin(newHeading), Math.cos(newHeading))
    // if(newHeading == -0.000) {
    //     newHeading = +0.000
    // }
    return newHeading
    // return newHeading
}

//gets distance sensor + encoder data from the arduino
//gets imu data
//sets robotData values
function getAllData() {
    robotData.imu = imu.getGyro()
    try {
        board.io.i2cConfig({
            address: arduino
        })
        board.io.i2cReadOnce(arduino, 10, (bytes) => {
            //bytes[2], [3], [4], [5] == left encoder
            //bytes[6], [7], [8], [9] == right encoder
            robotData.ultrasonicArray = [bytes[0], bytes[1]]
            let leftEncoder = Buffer.from([bytes[2], bytes[3], bytes[4], bytes[5]])
            let leftTick = Number(leftEncoder.readInt32BE(0).toString())
            let rightEncoder = Buffer.from([bytes[6], bytes[7], bytes[8], bytes[9]])
            let rightTick = Number(rightEncoder.readInt32BE(0).toString())
            robotData.deltaTL = Number((leftTick - robotData.leftTickTotal).toFixed(3))
            robotData.deltaTR = Number((rightTick - robotData.rightTickTotal).toFixed(3))
            let tpsR = robotData.rightRPM / (60 * 40)
            let tpsL = robotData.leftRPM / (60 * 40)
            let ticksR = Math.round(tpsR * dt)
            let ticksL = Math.round(tpsL * dt)
            if (robotData.deltaTL > ticksL + 15) {
                robotData.leftTickTotal = robotData.leftTickTotal + ticksL
                robotData.deltaTL = ticksL
            }
            else if (leftTick < 0) {
                robotData.leftTickTotal = robotData.leftTickTotal + ticksL
                robotData.deltaTL = ticksL
            }
            else {
                robotData.leftTickTotal = leftTick
            }
            if (robotData.deltaTR > tpsR + 15) {
                robotData.rightTickTotal = robotData.rightTickTotal + ticksR
                robotData.deltaTR = ticksR
            }
            else if (rightTick < 0) {
                robotData.rightTickTotal = robotData.rightTickTotal + ticksR
                robotData.deltaTR = ticksR
            }
            else {
                robotData.rightTickTotal = rightTick
            }
        })
        if(robotData.rightDir == 2) {
            robotData.deltaTR = -robotData.deltaTR
        }
        if(robotData.leftDir == 2) {
            robotData.deltaTL = -robotData.deltaTL
        }
        getNewPos()
    }
    catch (err) {
        console.log("---------------------------------------------------------------------")
        console.log(err)
        let tpsR = robotData.rightRPM / (60 * 40)
        let tpsL = robotData.leftRPM / (60 * 40)
        let ticksR = Math.round(tpsR * dt)
        let ticksL = Math.round(tpsL * dt)
        robotData.leftTickTotal = robotData.leftTickTotal + ticksL
        robotData.rightTickTotal = robotData.rightTickTotal + ticksR
        robotData.deltaTL = ticksL
        robotData.deltaTR = ticksR
        motorCommand(0, 0)
        handleCommsErr()
        // getNewPos()
    }
}

//updates the LCD screen with the x, y, and heading position of the robot 
function updateLCD() {
    try {
        LCD.cursor(0, 0).print(`x position: `)
        LCD.cursor(0, 13).print(robotData.posX.toString())
        LCD.cursor(1, 0).print(`y position: `)
        LCD.cursor(1, 13).print(robotData.posY.toString())
        LCD.cursor(2, 0).print(`heading: `)
        LCD.cursor(2, 9).print(robotData.heading.toString())
    }
    catch (err) {
        console.log("-------------LCD ERROR-------------------")
    }
}

//calculates the robots current position
function getNewPos() {
    //right wheel distance in mm
    let dr = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTR / 40)
    //left wheel distance in mm
    let dl = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTL / 40)
    dr = Number(dr.toFixed(4))
    dl = Number(dl.toFixed(4))
    //center of wheelbase distance in mm
    let dc = (dl + dr) / 2
    let rightRadPerSec = (dr / dt) / robotData.wheelRadius
    let leftRadPerSec = (dl / dt) / robotData.wheelRadius
    //right rpm
    robotData.rightRPM = (rightRadPerSec / (2 * Math.PI)) * 60
    //left rpm
    robotData.leftRPM = (leftRadPerSec / (2 * Math.PI)) * 60
    //Calculate robot heading
    let headingEncoders = Number((robotData.heading + ((dr - dl) / robotData.wheelBase)).toFixed(3))
    let headingImu = Number((robotData.heading + robotData.imu[2] * 0.0174533 * dt).toFixed(4))
    // if (headingEncoders > headingImu) {
    //     robotData.heading = (0.2 * headingEncoders + 0.8 * headingImu)
    // }
    // else {
    //     robotData.heading = (0.3 * headingEncoders + 0.7 * headingImu)
    // }
    robotData.heading = headingImu
    robotData.posX = Number((robotData.posX + dc * Math.cos(robotData.heading)).toFixed(3))
    robotData.posY = Number((robotData.posY + dc * Math.sin(robotData.heading)).toFixed(3))
    // console.log(headingImu, headingEncoders, robotData.heading)
    // console.log(robotData.imu)
    goToGoal()
}

//calculates the x and y errors
//checks if the robot has reach its goal
function goToGoal() {
    let u1 = xGoal - robotData.posX
    let u2 = yGoal - robotData.posY

    //NEED a fix here

    u1 = Number(u1.toFixed(3))
    u2 = Number(u2.toFixed(3))
    PID([u1, u2])
}

//the PID controller for heading adjustment
function PID(u) {
    // console.log("Computing controller outputs")
    let oldErr = robotData.headingErr
    // robotData.headingErr = Number((headingAngle - robotData.heading).toFixed(3)))
    robotData.headingErr = Math.atan2(Math.sin(headingAngle - robotData.heading), Math.cos(headingAngle - robotData.heading))
    let deltaErr = robotData.headingErr - oldErr
    robotData.sumErr = Number((robotData.sumErr + robotData.headingErr).toFixed(3))
    let omega = KP * robotData.headingErr + KI * robotData.sumErr * dt + KD * (deltaErr / dt)
    motorVals(omega, u)
}

//calculates the unmapped outputs for the right and left motors
function motorVals(pidOut, u) {
    let v = Math.abs(Math.sqrt((u[0] * u[0]) + (u[1] * u[1])))
    pidOut = Number(pidOut.toFixed(5))
    v = Number(v.toFixed(3))
    let vr = Math.round((2 * v + pidOut * robotData.wheelBase) / (2 * robotData.wheelRadius))
    let vl = Math.round((2 * v - pidOut * robotData.wheelBase) / (2 * robotData.wheelRadius))
    //
    // data log
    // console.log(robotData.leftDir, robotData.rightDir)
    console.log(headingAngle.toFixed(3), robotData.heading.toFixed(3), robotData.headingErr.toFixed(3), robotData.posX, robotData.posY, robotData.leftTickTotal, robotData.rightTickTotal, vl, vr)
    // console.log(vr, vl)
    motorCommand(vr, vl)
}

//maps the right and left motor outputs to pwm commands for the arduino
function motorCommand(vr, vl) {
    //forward direction == 1
    //reverse direction == 2
    //speed 5 to 35 = 200 to 255
    const vMax = 255
    const vMin = 170
    let spdL
    let spdR
    let dirL = 1
    let dirR = 1
    const upperThresh = 100
    const lowerThresh = 1
    const threshRange = upperThresh - lowerThresh
    const maxRange = vMax - vMin
    let absVr = Math.abs(vr)
    let absVl = Math.abs(vl)
    robotData.rightDir = 1
    robotData.leftDir = 1

    if (vr < 0) {
        vr = 0
        // dirR = 2
        // robotData.rightDir = 2
    }
    if (vl < 0) {
        vl = 0
        // dirL = 2
        // robotData.leftDir = 2
    }

    if (absVr > upperThresh) {
        spdR = vMax
    }

    if (absVr > 0 && absVr < lowerThresh) {
        spdR = vMin
    }

    if (absVr >= lowerThresh && absVr <= upperThresh) {
        spdR = (((absVr - lowerThresh) * maxRange) / threshRange) + vMin
    }

    if (absVl > upperThresh) {
        spdL = vMax
    }

    if (absVl > 0 && absVl < lowerThresh) {
        spdL = vMin
    }

    if (absVl >= lowerThresh && absVl <= upperThresh) {
        spdL = (((absVl - lowerThresh) * maxRange) / threshRange) + vMin
    }
    if (vl == 0) {
        spdL = 0
    }
    if (vr == 0) {
        spdR = 0
    }

    let cmd = 2
    spdL = Math.round(spdL)
    spdR = Math.round(spdR)
    if(dirR == 2 || dirL == 2) {
        spdL = 0.8 * spdL
        spdR = 0.8 * spdR
    }
    // console.log(dirR, dirL)
    robotData.leftDir = dirL
    robotData.rightDir = dirR
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [cmd, dirL, spdL, dirR, spdR])
    if (count < 3) {
        count++
    }
}

//resets the arduino encoder counts
function resetArduino() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [3])
}

//resets the robot data
//resets the error sum of the robot
// function resetRobotData() {
//     // let keys = Object.keys(robotData)
//     // keys.forEach(key => {
//     //     if (key != "ultrasonicArray" && key != "imu" && key != "wheelBase" && key != "wheelRadius" && key != "posX" && key != "posY") {
//     //         robotData[key] = 0
//     //     }
//     // })
//     // // xGoal = 0
//     // // yGoal = 0
//     robotData.sumErr = 0
//     return console.log("Robot reset", robotData)
// }

//sets the arduinos encoder counts to the last known good count upon communications error
function handleCommsErr() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [4, robotData.leftTickTotal, robotData.rightTickTotal])
    getAllData()
}

board.on('ready', function () {
    console.log('Board is ready')

    io.on('connection', (socket) => {
        console.log("connection successful")
        socket.on("move", (dir) => {
            switch (dir) {
                case "forward":
                    motorCommand(1, 255)
                    break
                case "reverse":
                    motorCommand(2, 255)
                    break
                case "left":
                    piMotors.enable.high()
                    piMotors.turn(piMotors.motors, "left", 255)
                    break
                case "right":
                    piMotors.enable.high()
                    piMotors.turn(piMotors.motors, "right", 255)
                    break
                case "stop":
                    motorCommand(1, 0)
                default:
                    console.log("not moving")
            }
        })
    })
    getGoal()
})

http.listen(3000, () => console.log('listening on port 3000'))
