/*!
 * Copyright 2017-2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance with the License. A copy of
 * the License is located at
 *     http://aws.amazon.com/asl/
 * or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
import { Action, applyMiddleware, createStore, compose, combineReducers, Store } from 'redux';
import { offline } from '@redux-offline/redux-offline';
import offlineConfig from '@redux-offline/redux-offline/lib/defaults';
import { PERSIST_REHYDRATE } from "@redux-offline/redux-offline/lib/constants";
import thunk from 'redux-thunk';

import { AWSAppSyncClient } from '../client';
import { reducer as cacheReducer, NORMALIZED_CACHE_KEY, METADATA_KEY } from '../cache/index';
import { reducer as offlineMetadataReducer, offlineEffect, discard } from '../link/offline-link';
import storage from './storage';

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
            applyMiddleware(thunk),
            offline({
                ...offlineConfig,
                persistCallback,
                persistOptions: {
                    whitelist: [NORMALIZED_CACHE_KEY, METADATA_KEY, 'offline'],
                    storage,
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
