// @generated by protobuf-ts 2.9.1
// @generated from protobuf file "proto/helloworld.proto" (package "helloworld", syntax proto3)
// tslint:disable
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { Greeter } from "./helloworld";
import { stackIntercept } from "@protobuf-ts/runtime-rpc";
import type { HelloReply } from "./helloworld";
import type { HelloRequest } from "./helloworld";
import type { UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
/**
 * @generated from protobuf service helloworld.Greeter
 */
export interface IGreeterClient {
    /**
     * Our SayHello rpc accepts HelloRequests and returns HelloReplies
     *
     * @generated from protobuf rpc: SayHello(helloworld.HelloRequest) returns (helloworld.HelloReply);
     */
    sayHello(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloReply>;
}
/**
 * @generated from protobuf service helloworld.Greeter
 */
export class GreeterClient implements IGreeterClient, ServiceInfo {
    typeName = Greeter.typeName;
    methods = Greeter.methods;
    options = Greeter.options;
    constructor(private readonly _transport: RpcTransport) {
    }
    /**
     * Our SayHello rpc accepts HelloRequests and returns HelloReplies
     *
     * @generated from protobuf rpc: SayHello(helloworld.HelloRequest) returns (helloworld.HelloReply);
     */
    sayHello(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloReply> {
        const method = this.methods[0], opt = this._transport.mergeOptions(options);
        return stackIntercept<HelloRequest, HelloReply>("unary", this._transport, method, opt, input);
    }
}
