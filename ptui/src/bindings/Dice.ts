// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.

export type Dice = { Expr: { num: number, size: number, } } | { Plus: [Dice, Dice] } | { Flat: { value: number, } } | { BestOf: [number, Dice] };