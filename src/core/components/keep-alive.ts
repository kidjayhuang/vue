import { isRegExp, isArray, remove } from 'shared/util'
import { getFirstComponentChild } from 'core/vdom/helpers/index'
import type VNode from 'core/vdom/vnode'
import type { VNodeComponentOptions } from 'types/vnode'
import type { Component } from 'types/component'
import { getComponentName } from '../vdom/create-component'

type CacheEntry = {
  name?: string
  tag?: string
  componentInstance?: Component
}

type CacheEntryMap = Record<string, CacheEntry | null>

function _getComponentName(opts?: VNodeComponentOptions): string | null {
  return opts && (getComponentName(opts.Ctor.options as any) || opts.tag)
}
/* 检测name是否匹配 */
function matches(
  pattern: string | RegExp | Array<string>,
  name: string
): boolean {
  if (isArray(pattern)) {
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    /* 字符串情况，如a,b,c */
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    /* 正则 */
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}
/* 修正cache */
function pruneCache(
  keepAliveInstance: { cache: CacheEntryMap; keys: string[]; _vnode: VNode },
  filter: Function
) {
  const { cache, keys, _vnode } = keepAliveInstance
  for (const key in cache) {
    /* 取出cache中的vnode */
    const entry = cache[key]
    if (entry) {
      const name = entry.name
      /* name不符合filter条件的，同时不是目前渲染的vnode时，销毁vnode对应的组件实例（Vue实例），并从cache中移除 */
      if (name && !filter(name)) {
        pruneCacheEntry(cache, key, keys, _vnode)
      }
    }
  }
}
/* 销毁vnode对应的组件实例（Vue实例） */
function pruneCacheEntry(
  cache: CacheEntryMap,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  const entry = cache[key]
  if (entry && (!current || entry.tag !== current.tag)) {
    // @ts-expect-error can be undefined
    entry.componentInstance.$destroy()
  }
  cache[key] = null
  remove(keys, key)
}

const patternTypes: Array<Function> = [String, RegExp, Array]

// TODO defineComponent
export default {
  name: 'keep-alive',
  abstract: true,

  props: {
    include: patternTypes,
    exclude: patternTypes,
    max: [String, Number]
  },

  methods: {
    cacheVNode() {
      const { cache, keys, vnodeToCache, keyToCache } = this
      if (vnodeToCache) {
        const { tag, componentInstance, componentOptions } = vnodeToCache
        cache[keyToCache] = {
          name: _getComponentName(componentOptions),
          tag,
          componentInstance
        }
        keys.push(keyToCache)
        // prune oldest entry
        if (this.max && keys.length > parseInt(this.max)) {
          pruneCacheEntry(cache, keys[0], keys, this._vnode)
        }
        this.vnodeToCache = null
      }
    }
  },

  created() {
    this.cache = Object.create(null)
    this.keys = []
  },

  destroyed() {
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  mounted() {
    this.cacheVNode()
    /* 监视include以及exclude，在被修改的时候对cache进行修正 */
    this.$watch('include', val => {
      pruneCache(this, name => matches(val, name))
    })
    this.$watch('exclude', val => {
      pruneCache(this, name => !matches(val, name))
    })
  },

  updated() {
    this.cacheVNode()
  },

  render() {
    /* 得到slot插槽中的第一个组件 */
    const slot = this.$slots.default
    const vnode = getFirstComponentChild(slot)
    const componentOptions = vnode && vnode.componentOptions
    if (componentOptions) {
      // check pattern
      /* 获取组件名称，优先获取组件的name字段，否则是组件的tag */
      const name = _getComponentName(componentOptions)
      /* name不在inlcude中或者在exlude中则直接返回vnode（没有取缓存） */
      const { include, exclude } = this
      if (
        // not included
        (include && (!name || !matches(include, name))) ||
        // excluded
        (exclude && name && matches(exclude, name))
      ) {
        return vnode
      }

      const { cache, keys } = this
      const key =
        vnode.key == null
          ? // same constructor may get registered as different local components
            // so cid alone is not enough (#3269)
            componentOptions.Ctor.cid +
            (componentOptions.tag ? `::${componentOptions.tag}` : '')
          : vnode.key
      /* 如果已经做过缓存了则直接从缓存中获取组件实例给vnode，还未缓存过则进行缓存 */
      if (cache[key]) {
        vnode.componentInstance = cache[key].componentInstance
        // make current key freshest
        remove(keys, key)
        keys.push(key)
      } else {
        // delay setting the cache until update
        this.vnodeToCache = vnode
        this.keyToCache = key
      }
      /* keepAlive标记位 */
      // @ts-expect-error can vnode.data can be undefined
      vnode.data.keepAlive = true
    }
    return vnode || (slot && slot[0])
  }
}
