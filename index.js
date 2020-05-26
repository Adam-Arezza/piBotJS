const five = require('johnny-five')
const cors = require('cors')
const express = require('express')
const app = express()
app.use(cors())
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const rpi = require('pi-io')
// const cv = require('opencv4nodejs')
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
const KI = 0.1
const KD = 0
let xGoal = 0
let yGoal = 0
let headingAngle = 0
let avoid = 0
let count = 0
let obstacles = 0
const obstacleThresh = 30
var reFresh
let dt = 0.04
let goals = []
let completed = []
let rightEncodeErr = 0
let leftEncodeErr = 0
const GYRO_OFFSET = {
    x: 1.5055801526717534,
    y: -1.4851297709923665,
    z: 1.1479847328244286
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
    ultrasonicArray: [],
    imu: [],
    wheelBase: 0.2286,
    wheelRadius: 0.030,
    rightRPM: 0,
    leftRPM: 0,
    vr: 0,
    vl: 0,
    pwmR: 0,
    pwmL: 0,
    fwStart: [],
    objEdge: []
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
    setTimeout(resetArduino, 10)
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
            headingAngle = Number(Math.atan2(yGoal, xGoal).toFixed(3))
            if (answers.another) {
                return getGoal()
            }
            if (!answers.another) {
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

function checkGoalReached() {
    if (leftEncodeErr >= 50 || rightEncodeErr >= 50) {
        encoderErr()
    }
    let maxErr = 0.035
    let xErr = Math.abs(robotData.posX - xGoal)
    let yErr = Math.abs(robotData.posY - yGoal)
    //may need a fix here for stopping threshold
    if (Math.abs(robotData.headingErr) <= 0.06) {
        if (xErr <= maxErr && yErr <= maxErr) {
            // robotData.sumErr = 0
            console.log(1)
            return nextGoal()
        }

        if (completed.length >= 1) {
            if (xGoal != completed[0][0] && yGoal == completed[0][1] && xErr <= maxErr) {
                return nextGoal()
            }

            if (yGoal != completed[0][1] && xGoal == completed[0][0] && yErr <= maxErr) {
                return nextGoal()
            }
        }
        if (Math.abs(xGoal) > 0 && Math.abs(yGoal) > 0) {
            if (robotData.posX > Math.abs(xGoal) && robotData.posY > Math.abs(yGoal)) {
                // robotData.sumErr = 0
                console.log(2)
                return nextGoal()
            }
        }

        if (xGoal == 0 && yGoal != 0) {
            if (Math.abs(robotData.posX) <= maxErr +0.04 && Math.abs(robotData.posY) >= Math.abs(yGoal)) {
                // robotData.sumErr = 0
                console.log(3)
                return nextGoal()
            }
        }
        if (yGoal == 0 && xGoal != 0) {
            if (Math.abs(robotData.posY) <= maxErr + 0.04 && Math.abs(robotData.posX) >= Math.abs(xGoal)) {
                // robotData.sumErr = 0
                console.log(4)
                return nextGoal()
            }
        }
        if (xGoal == 0 && yGoal == 0) {
            if (Math.abs(robotData.posX) <= 0.1 && Math.abs(robotData.posY) <= 0.1) {
                // robotData.sumErr = 0
                console.log(5)
                return nextGoal()
            }
        }
    }

    return getAllData()
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
        board.io.i2cReadOnce(arduino, 11, (bytes) => {
            //bytes[2], [3], [4], [5] == left encoder
            //bytes[6], [7], [8], [9] == right encoder
            
            robotData.ultrasonicArray = [bytes[0], bytes[1], bytes[10]]
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
            // console.log(leftTick, rightTick)
            if (!robotData.deltaTR && robotData.vr) {
                rightEncodeErr++
            }
            else {
                rightEncodeErr = 0
            }
            if (!robotData.deltaTL && robotData.vl) {
                leftEncodeErr++
            }
            else {
                leftEncodeErr = 0
            }
            if (robotData.deltaTL > ticksL + 15 || leftTick < 0) {
                robotData.leftTickTotal = robotData.leftTickTotal + ticksL
                robotData.deltaTL = ticksL
            }
            else {
                robotData.leftTickTotal = leftTick
            }
            if (robotData.deltaTR > tpsR + 15 || rightTick < 0) {
                robotData.rightTickTotal = robotData.rightTickTotal + ticksR
                robotData.deltaTR = ticksR
            }
            else {
                robotData.rightTickTotal = rightTick
            }
        })
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
        stopMotors()
        handleCommsErr()
    }
}

//calculates the robots current pose
function getNewPos() {
    //right wheel distance in mm
    let dr 
    let dl 

    if(robotData.deltaTR) {
        dr = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTR / 40)
    }
    else if(!robotData.deltaTR && robotData.pwmR) {
        dr = 2 * Math.PI * robotData.wheelRadius * (0.545 * robotData.pwmR -3.59) * (dt / 60)
    }
    else {
        dr = 0
    }
    //left wheel distance in mm
    if(robotData.deltaTL) {
        dl = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTL / 40)
    }
    else if(!robotData.deltaTL && robotData.pwmL) {
        dl = 2 * Math.PI * robotData.wheelRadius * (0.397 * robotData.pwmL + 50.2) * (dt / 60) 
    }
    else {
        dl = 0
    }

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
    robotData.heading = headingImu
    robotData.posX = Number((robotData.posX + dc * Math.cos(robotData.heading)).toFixed(3))
    robotData.posY = Number((robotData.posY + dc * Math.sin(robotData.heading)).toFixed(3))
    // console.log(headingImu, headingEncoders, robotData.heading)
    // console.log(robotData.imu)
    if(!avoid && robotData.ultrasonicArray[1] < obstacleThresh) {
        followBoundary()
    }
    if(avoid && robotData.ultrasonicArray[2] > obstacleThresh && robotData.ultrasonicArray[1] > obstacleThresh) {
        if( robotData.objEdge.length < 1 ) {
            robotData.objEdge.push(robotData.posX)
            robotData.objEdge.push(robotData.posY)
        }
        stopFollowBoundary()
    }
    if(!avoid && robotData.ultrasonicArray[2] > obstacleThresh && robotData.ultrasonicArray[1] > obstacleThresh && obstacles > 0 ) {
        headingAngle = Math.atan2((yGoal - robotData.posY), (xGoal - robotData.posX))
    }
    getDistToGoal()
}

//calculates the x and y errors
function getDistToGoal() {
    let u1
    let u2
    u1 = xGoal - robotData.posX
    u2 = yGoal - robotData.posY
    if (Math.abs(u1) <= 0.02) {
        u1 = 0
    }
    if (Math.abs(u2) <= 0.02) {
        u2 = 0
    }

    u1 = Number(u1.toFixed(3))
    u2 = Number(u2.toFixed(3))
    PID([u1, u2])
}

//the PID controller for heading adjustment
function PID(u) {
    let oldErr = robotData.headingErr
    // robotData.headingErr = Number((headingAngle - robotData.heading).toFixed(3))
    robotData.headingErr = Number(Math.atan2(Math.sin(headingAngle - robotData.heading), Math.cos(headingAngle - robotData.heading)).toFixed(3))
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
    console.log(headingAngle, robotData.heading, robotData.headingErr, robotData.posX, robotData.posY, robotData.leftTickTotal, robotData.rightTickTotal, vr, vl)
    // console.log(vr, vl)
    motorCommand(vr, vl)
}

//maps the right and left motor outputs to pwm commands for the arduino
function motorCommand(vr, vl) {
    //forward direction == 1
    const vMax = 255
    const vMin = 180
    let spdL
    let spdR
    let dirL = 1
    let dirR = 1
    const upperThresh = 100
    const lowerThresh = 1
    const threshRange = upperThresh - lowerThresh
    const maxRange = vMax - vMin

    if (vr < 0) {
        vr = 0
    }
    if (vl < 0) {
        vl = 0
    }

    robotData.vr = vr
    robotData.vl = vl

    if (vr > upperThresh) {
        spdR = vMax
    }

    if (vr > 0 && vr < lowerThresh) {
        spdR = vMin
    }

    if (vr >= lowerThresh && vr <= upperThresh) {
        spdR = (((vr - lowerThresh) * maxRange) / threshRange) + vMin
    }

    if (vl > upperThresh) {
        spdL = vMax
    }

    if (vl > 0 && vl < lowerThresh) {
        spdL = vMin
    }

    if (vl >= lowerThresh && vl <= upperThresh) {
        spdL = (((vl - lowerThresh) * maxRange) / threshRange) + vMin
    }
    if (vl == 0) {
        spdL = 0
    }
    if (vr == 0) {
        spdR = 0
    }

    spdL = Math.round(spdL)
    spdR = Math.round(spdR)
    // console.log(dirR, dirL)
    robotData.pwmR = spdR
    robotData.pwmL = spdL
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [2, dirL, spdL, dirR, spdR])
    if (count < 3) {
        count++
    }
}

function stop() {
    cleanup()
    console.log(`Goals: ${goals}`)
    console.log(`Completed: ${completed}`)
    console.log(`Final position X: ${robotData.posX} Y: ${robotData.posY}`)
    console.log(`X position error: ${xGoal - robotData.posX}`)
    console.log(`Y position error: ${yGoal - robotData.posY}`)
    console.log(`heading error: ${robotData.headingErr}`)
    return
}

function encoderErr() {
    // console.log("clearing interval")
    // clearInterval(reFresh)
    // setTimeout(stopMotors, 100)
    console.log("Encoder Error. Reseting Arduino and counts")
    setTimeout(resetArduino, 50)
    setTimeout(handleCommsErr, 100)
    // console.log(`Left encoder error: ${leftEncodeErr}`)
    // console.log(`Right encoder error: ${rightEncodeErr}`)
}

function stopMotors() {
    board.io.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [5])
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
        clearInterval(reFresh)
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
    return checkGoalReached()
}

//calculates the new heading goal based on the last 2 vectors
function getNewHeadingGoal(v1, v2) {
    let dotProd = v1[0] * v2[0] + v1[1] * v2[1]
    let v1Mag = Math.sqrt(Math.pow(v1[0], 2) + Math.pow(v1[1], 2))
    let v2Mag = Math.sqrt(Math.pow(v2[0], 2) + Math.pow(v2[1], 2))
    let newHeading = Number(Math.acos((dotProd) / (v1Mag * v2Mag)).toFixed(4))
    let totalHeading = Number((headingAngle + newHeading).toFixed(4))
    console.log(`New heading: ${newHeading}`)
    console.log(`Total: ${totalHeading}`)
    console.log(`Total atan2: ${Math.atan2(Math.sin(totalHeading), Math.cos(totalHeading))}`)
    if (totalHeading == Number(Math.PI.toFixed(4)) && v1[1] == 0) {
        return totalHeading
    }

    if (totalHeading <= Number(Math.PI.toFixed(4)) && v1[1] <= 0) {
        console.log("total is less than 180 go right")
        newHeading = headingAngle - newHeading
        return newHeading
    }

    if (totalHeading < Number(Math.PI.toFixed(4)) && v1[1] > 0) {
        return newHeading
    }

    if (totalHeading > Number(Math.PI.toFixed(4)) && v1[1] < 0) {
        console.log("total is greater than 180 go left")
        return headingAngle + newHeading
        // return newHeading
    }
    console.log(`Delta y: ${v1[1]}`)
    return Number(Math.atan2(Math.sin(totalHeading), Math.cos(totalHeading)).toFixed(4))
}

//resets the arduino
function resetArduino() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [3])
    console.log("reset arduino")
}

//sets the arduinos encoder counts to the last known good count upon communications error
function handleCommsErr() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [4, robotData.leftTickTotal, robotData.rightTickTotal])
    checkGoalReached()
}

function cleanup() {
    clearInterval(reFresh)
    console.log("cleanup")
    setTimeout(stopMotors, 50)
    setTimeout(resetArduino, 100)
}

function followBoundary() {
    obstacles ++
    avoid = 1
    headingAngle = headingAngle + Math.PI / 2
    if(robotData.fwStart.length < 1) {
        robotData.fwStart.push(robotData.posX)
        robotData.fwStart.push(robotData.posY)
    }
    // robotData.headingErr = Number(Math.atan2(Math.sin(avoid - robotData.heading), Math.cos(avoid - robotData.heading)).toFixed(3))
}

function stopFollowBoundary() {
    if(robotData.posY > robotData.objEdge[1] + 0.2 || robotData.posX > robotData.objEdge[0] + 0.2) {
        headingAngle = headingAngle - Math.PI / 2
        avoid = 0
        robotData.objEdge = []
    }
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

board.on("exit", () => {
    cleanup()
})

board.on("close", () => {
    cleanup()
    console.log("the board has closed")
})

http.listen(3000, () => console.log('listening on port 3000'))