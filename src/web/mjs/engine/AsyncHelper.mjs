
class AsyncWaitableExt {
    constructor(data) {
        this.promise = null;
        this.data = data || null;
        this.resolveFn = null;
        this.rejectFn = null;
        this.state = 'pending';
        this.value = undefined;
        this.reason = undefined;
    }
    
    resolve(value) {
        if (this.state !== 'pending')
            throw new Error(`Invalid state ${this.state} for resolve`);
        this.state = 'fulfilled';
        this.value = value;
        this.resolveFn({ aw: this, value });
    }

    reject(reason) {
        if (this.state !== 'pending')
            throw new Error(`Invalid state ${this.state} for reject`);
        this.state = 'rejected';
        this.reason = reason;
        this.rejectFn({ aw: this, reason });
    }
}

class AsyncHelper {
    createAsyncWaitable = (data) => {
        let d = new AsyncWaitableExt(data);
        let p = new Promise((resolveFn, rejectFn) => {
            d.resolveFn = resolveFn;
            d.rejectFn = rejectFn;
        });
        d.promise = p;
        return d;
    }

    race = (awSource, options) => {
        let { return_type } = options || { return_type: '' };
        let { promiseArray, orderedArray } = this._awSourceToArray(awSource);
        function makeReturnValue(aw) {
            if (return_type === 'full') {
                let index = (orderedArray !== null) ? orderedArray.indexOf(aw) : -1;
                return [ aw, index, Array.from(awSource).filter(aw1 => aw1 !== aw) ];
            } else {
                return aw;
            }
        }
        return Promise.race(promiseArray).then(({ aw, value }) => makeReturnValue(aw)).catch(({ aw, reason }) => makeReturnValue(aw));
    }

    allSettled = (awSource) => {
        let { promiseArray, orderedArray } = this._awSourceToArray(awSource);
        return Promise.allSettled(promiseArray).then(() => orderedArray);
    }

    async * raceIter(awSource, options) {
        let { return_type } = options || { return_type: '' };
        let { promiseSet, orderedArray } = this._awSourceToSet(awSource);
        for (let aw of awSource) promiseSet.add(aw.promise);
        while (promiseSet.size > 0) {
            let { aw, value } = await Promise.race(promiseSet).catch(({ aw, reason }) => { value: undefined, aw });
            promiseSet.delete(aw.promise);
            if (return_type === 'full') {
                let index = (orderedArray !== null) ? orderedArray.indexOf(aw) : -1;
                yield [ aw, index, Array.from(promiseSet).map(p => p.d) ];
            } else {
                yield aw;
            }
        }
    }

    _awSourceToArray = (awSource) => {
        let orderedArray = Array.isArray(awSource) ? awSource : Array.from(awSource);
        let promiseArray = orderedArray.map(aw => aw.promise);
        return { promiseArray, orderedArray: Array.isArray(awSource) ? orderedArray : null };
    }

    _awSourceToSet = (awSource) => {
        let promiseSet = new Set;
        let orderedArray = Array.isArray(awSource) ? awSource : null;
        for (let aw of awSource) promiseSet.add(aw.promise);
        return { promiseSet, orderedArray };
    }
}

export default new AsyncHelper;