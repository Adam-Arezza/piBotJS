const five = require('johnny-five')
const rpi = require('pi-io')

const board = new five.Board({
    io: new rpi(),
    repl: false
}) 

board.on("ready" , function() {
    
})