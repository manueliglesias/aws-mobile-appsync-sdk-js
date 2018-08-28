import { Action, applyMiddleware, createStore, compose, combineReducers, Store } from 'redux';
import { offline } from '@redux-offline/redux-offline';
import offlineConfig from '@redux-offline/redux-offline/lib/defaults';
import { PERSIST_REHYDRATE } from "@redux-offline/redux-offline/lib/constants";
import thunk from 'redux-thunk';

import { AWSAppSyncClient } from './client';
import { reducer as cacheReducer, NORMALIZED_CACHE_KEY, METADATA_KEY } from './cache/index';
import { reducer as offlineMetadataReducer, offlineEffect, discard } from './link/offline-link';

const cosa = store => next => action => { 
    console.warn(action.type);
    if (action.type === 'ROLLBACK_OFFLINE_MUTATION') {
        console.warn(action);
        throw new Error(action.type);
    }
    const result = next(action);

    return result;
}

/**
 * 
 * @param {() => AWSAppSyncClient} clientGetter
 * @param {Function} persistCallback 
 * @param {Function} conflictResolver 
 */
const newStore = (clientGetter = () => null, persistCallback = () => null, conflictResolver, dataIdFromObject) => {
    const store = createStore(
        combineReducers({
            rehydrated: (state = false, action) => {
                switch (action.type) {
                    case PERSIST_REHYDRATE:
                        return true;
                    default:
                        return state;
                }
            },
            ...cacheReducer(),
            ...offlineMetadataReducer(dataIdFromObject),
        }),
        typeof window !== 'undefined' && (window as any).__REDUX_DEVTOOLS_EXTENSION__ && (window as any).__REDUX_DEVTOOLS_EXTENSION__(),
        compose(
            applyMiddleware(thunk, cosa),
            offline({
                ...offlineConfig,
                persistCallback,
                persistOptions: {
                    whitelist: [NORMALIZED_CACHE_KEY, METADATA_KEY, 'offline']
                },
                effect: (effect, action) => offlineEffect(store, clientGetter(), effect, action),
                discard: discard(conflictResolver),
            })
        )
    );

    return store;
};

export {
    newStore as createStore
}
