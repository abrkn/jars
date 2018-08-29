# Jars

JSON-RPC over Redis

## Install

`npm install jars`

## Usage

[See tests](test.js)

## How it works

- Services listen for RPC requests using Redis lists
- Clients receive responses using Redis pub/sub

### Calculator

```
SERVER: BLPOP jars.rpc.calculator
CLIENT: SUBSCRIBE jars.reply.foo
CLIENT: LPUSH jars.rpc.calculator {id:1,method:"sum",params:[1,2],meta:{replyChannel:"foo"}}
SERVER: PUBLISH jars.reply.foo {id:1,status:"ack"}
SERVER: BLPOP jars.rpc.calculator
SERVER: PUBLISH jars.reply.foo {id:1,result:3}
```

## Author

Andreas Brekken <andreas@brekken.com>

## License

MIT
