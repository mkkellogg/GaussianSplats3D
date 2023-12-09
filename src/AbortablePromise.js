/**
 * AbortablePromise: A quick & dirty wrapper for JavaScript's Promise class that allows the underlying
 * asynchronous operation to be cancelled. It is only meant for simple situations where no promise
 * chaining or merging occurs. It needs a significant amount of work to truly replicate the full
 * functionality of JavaScript's Promise class. Look at Util.fetchWithProgress() for example usage.
 */
export class AbortablePromise {

    constructor(promiseFunc, abortHandler) {

        let promiseResolve;
        let promiseReject;
        this.promise = new Promise((resolve, reject) => {
            promiseResolve = resolve.bind(this);
            promiseReject = reject.bind(this);
        });

        const resolve = (...args) => {
            promiseResolve(...args);
        };

        const reject = (error) => {
            promiseReject(error);
        };

        promiseFunc(resolve.bind(this), reject.bind(this));
        this.abortHandler = abortHandler;
    }

    then(onResolve) {
        return new AbortablePromise((resolve, reject) => {
            this.promise = this.promise
            .then((...args) => {
                const promiseLike = onResolve(...args);
                if (promiseLike instanceof Promise || promiseLike instanceof AbortablePromise) {
                    this.promise = promiseLike.then((...args) => {
                        resolve(...args);
                    })
                } else {
                    resolve(...args);
                }  
            });
        }, this.abortHandler);
    }

    catch(onFail) {
        return new AbortablePromise((resolve, reject) => {
            this.promise = this.promise
            .catch((error) => {
                reject(error);
            });
        }, this.abortHandler);
    }

    abort() {
        if (this.abortHandler) this.abortHandler();
    }

    static resolve(data) {
        return new AbortablePromise((resolve) => {
            resolve(data);
        });
    }

    static reject(error) {
        return new AbortablePromise((resolve, reject) => {
            reject(error);
        });
    }
}
