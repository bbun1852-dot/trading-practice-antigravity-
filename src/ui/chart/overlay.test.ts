import { describe, it, expect } from 'vitest'
import { mk } from '../../analysis/fixtures'
import type { Signal } from '../../analysis/signalTypes'
import { shapeFor, toShapes } from './overlay'

/**
 * 매핑이 지켜야 하는 것 (스펙 §6):
 * - refs 모양이 도형을 정한다 (태그 목록을 베끼지 않는다)
 * - 창 밖을 가리키는 봉 인덱스는 창 안으로 잘린다
 * - 사선의 시작 가격은 앵커 봉의 극값으로 복원한다
 */

const candles = Array.from({ length: 10 }, (_, i) => mk(100 + i, 110 + i, 90 + i, 105 + i, 100, i))

const sig = (over: Partial<Signal>): Signal => ({
  id: 'x', tier: 3, kind: 'smc', side: 'bullish', barIndex: 5,
  confidence: 'B', strength: 2, evidence: '', ...over,
})

describe('shapeFor', () => {
  it('priceHigh·priceLow 가 있으면 박스다 — 오더블록·FVG', () => {
    const s = sig({ id: 'fvg_bull', refs: { priceHigh: 120, priceLow: 110, fromBar: 2, toBar: 6 } })
    expect(shapeFor(s, candles)).toEqual({
      kind: 'box', id: 'fvg_bull', side: 'bullish', fromBar: 2, toBar: 6, priceHigh: 120, priceLow: 110,
    })
  })

  it('price 만 있으면 수평 레벨이다 — 스윕·피보·넥라인', () => {
    const s = sig({ id: 'liq_sweep_high', refs: { price: 118, fromBar: 1, toBar: 7 } })
    expect(shapeFor(s, candles)).toEqual({
      kind: 'level', id: 'liq_sweep_high', side: 'bullish', fromBar: 1, toBar: 7, price: 118,
    })
  })

  it('추세선은 사선이고, 시작 가격은 앵커 봉의 극값으로 복원한다', () => {
    const sup = sig({ id: 'trendline_support', refs: { price: 95, fromBar: 2, toBar: 6 } })
    expect(shapeFor(sup, candles)).toEqual({
      kind: 'line', id: 'trendline_support', side: 'bullish',
      fromBar: 2, fromPrice: candles[2].low, toBar: 6, toPrice: 95,
    })

    const res = sig({ id: 'trendline_resistance', side: 'bearish', refs: { price: 130, fromBar: 2, toBar: 6 } })
    expect(shapeFor(res, candles)).toMatchObject({ kind: 'line', fromPrice: candles[2].high, toPrice: 130 })
  })

  it('돌파는 방향이 앵커를 정한다 — 종가와 선의 위아래로 가르면 뒤집힌다', () => {
    // 강세 돌파: 저항선을 위로 뚫었으므로 선은 종가 아래에 있지만 앵커는 **고가**다
    const up = sig({ id: 'trendline_break', side: 'bullish', refs: { price: 95, fromBar: 2, toBar: 6 } })
    expect(shapeFor(up, candles)).toMatchObject({ kind: 'line', fromPrice: candles[2].high })

    const down = sig({ id: 'trendline_break', side: 'bearish', refs: { price: 130, fromBar: 2, toBar: 6 } })
    expect(shapeFor(down, candles)).toMatchObject({ kind: 'line', fromPrice: candles[2].low })
  })

  it('채널은 priceHigh·priceLow 가 있어도 사선이다 — 기울기가 있는 쪽이 우선이다', () => {
    const s = sig({ id: 'channel_upper', side: 'bearish', refs: { price: 130, priceLow: 95, priceHigh: 130, fromBar: 1, toBar: 8 } })
    expect(shapeFor(s, candles)?.kind).toBe('line')
  })

  it('refs 가 없으면 그 봉을 가리키는 표시다 — 강세는 저가, 약세는 고가에 붙는다', () => {
    expect(shapeFor(sig({ id: 'engulf_bull', barIndex: 4 }), candles)).toEqual({
      kind: 'marker', id: 'engulf_bull', side: 'bullish', bar: 4, price: candles[4].low,
    })
    expect(shapeFor(sig({ id: 'engulf_bear', side: 'bearish', barIndex: 4 }), candles)).toMatchObject({
      kind: 'marker', price: candles[4].high,
    })
  })

  it('창 밖을 가리키는 봉 인덱스는 창 안으로 자른다', () => {
    const s = sig({ id: 'flag_bull', refs: { price: 118, fromBar: -10, toBar: 99 } })
    expect(shapeFor(s, candles)).toMatchObject({ fromBar: 0, toBar: 9 })
  })

  it('봉이 없으면 그릴 것도 없다', () => {
    expect(shapeFor(sig({}), [])).toBeNull()
  })
})

describe('toShapes', () => {
  it('신호 목록을 도형 목록으로 옮긴다', () => {
    const shapes = toShapes([
      sig({ id: 'fvg_bull', refs: { priceHigh: 120, priceLow: 110, fromBar: 2, toBar: 6 } }),
      sig({ id: 'engulf_bull', barIndex: 3 }),
    ], candles)
    expect(shapes.map((s) => s.kind)).toEqual(['box', 'marker'])
  })
})
