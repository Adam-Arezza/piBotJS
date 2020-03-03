const five = require('johnny-five')
const rpi = require('pi-io')
const board = new five.Board({
    io: new rpi()
})

const proximity = new five.Proximity({
    controller: rpi.HCSR04, // Custom controller
    triggerPin: 'P1-11',
    echoPin: 'P1-16'
})

board.on("ready", function() {
    proximity.on('change', (data) => console.log(data))
})

board.on('fail', function (event) {
    console.log(event)
})
