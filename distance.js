const five = require('johnny-five')
const rpi = require('pi-io')

const board = new five.Board({
    io: new rpi(),
    repl: false
})

const arduino = 0x08

function getDist() {
    board.io.i2cConfig({
        address: arduino
    })
    board.io.i2cReadOnce(arduino, 11, (bytes) => {
       return console.log(bytes[0], bytes[1], bytes[10])
    })
}

board.on("ready" , function() {
    let reFresh = setInterval(getDist, 200)
})
