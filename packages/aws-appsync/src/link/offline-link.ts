/*!
 * Copyright 2017-2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance with the License. A copy of
 * the License is located at
 *     http://aws.amazon.com/asl/
 * or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
import { readQueryFromStore, defaultNormalizedCacheFactory, NormalizedCacheObject } from "apollo-cache-inmemory";
import { ApolloLink, Observable, Operation, execute, GraphQLRequest, NextLink, FetchResult } from "apollo-link";
import { getOperationDefinition, getOperationName, getMutationDefinition, resultKeyNameFromField, tryFunctionOrLogError } from "apollo-utilities";
import { PERSIST_REHYDRATE } from "@redux-offline/redux-offline/lib/constants";
import { OfflineAction } from "@redux-offline/redux-offline/lib/types";
import { DocumentNode, FieldNode, ExecutionResult } from "graphql";

import { NORMALIZED_CACHE_KEY, METADATA_KEY } from "../cache";
import { AWSAppsyncGraphQLError } from "../types";
import { Observer } from "apollo-client/util/Observable";
import { Store } from "redux";
import { OfflineCache } from "../cache/offline-cache";
import { isUuid } from "../utils";
import AWSAppSyncClient from "..";
import { ApolloCache } from "apollo-cache";
import { MutationUpdaterFn, MutationQueryReducersMap } from "apollo-client";
import { RefetchQueryDescription } from "apollo-client/core/watchQueryOptions";

const actions = {
    SAVE_SNAPSHOT: 'SAVE_SNAPSHOT',
    ENQUEUE: 'ENQUEUE_OFFLINE_MUTATION',
    COMMIT: 'COMMIT_OFFLINE_MUTATION',
    ROLLBACK: 'ROLLBACK_OFFLINE_MUTATION',
    SAVE_SERVER_ID: 'SAVE_SERVER_ID',
};

export class OfflineLink extends ApolloLink {

    private store: Store<OfflineCache>;

    constructor(store: Store<OfflineCache>) {
        super();
        this.store = store;
    }

    request(operation: Operation, forward: NextLink) {
        return new Observable(observer => {
            const { offline: { online } } = this.store.getState();
            const { operation: operationType } = getOperationDefinition(operation.query);
            const isMutation = operationType === 'mutation';
            const isQuery = operationType === 'query';

            if (!online && isQuery) {
                const data = processOfflineQuery(operation, this.store);

                observer.next({ data });
                observer.complete();

                return () => null;
            }

            if (isMutation) {
                const { AASContext: { doIt = false } = {}, cache } = operation.getContext();

                if (!doIt) {
                    const { [METADATA_KEY]: { snapshot: { enqueuedMutations } } } = this.store.getState();

                    if (enqueuedMutations === 0) {
                        boundSaveSnapshot(this.store, cache);
                    }

                    const data = enqueueMutation(operation, this.store, observer);

                    if (!online) {
                        // TODO: Flag response as "non real"
                        observer.next({ data });
                        observer.complete();
                    }

                    return () => null;
                }
            }

            const handle = forward(operation).subscribe({
                next: observer.next.bind(observer),
                error: observer.error.bind(observer),
                complete: observer.complete.bind(observer),
            });

            return () => {
                if (handle) handle.unsubscribe();
            };
        });
    }
}

const boundSaveSnapshot = (store, cache) => store.dispatch(saveSnapshot(cache));
const saveSnapshot = (cache) => ({
    type: actions.SAVE_SNAPSHOT,
    payload: { cache },
});

const processOfflineQuery = (operation: Operation, theStore: Store<OfflineCache>) => {
    const { [NORMALIZED_CACHE_KEY]: normalizedCache = {} } = theStore.getState();
    const { query, variables } = operation;

    const store = defaultNormalizedCacheFactory(normalizedCache);

    const data = readQueryFromStore({
        store,
        query,
        variables,
    });

    return data;
}

type EnqueuedMutationEffect<T> = {
    optimisticResponse: object,
    operation: GraphQLRequest,
    update: MutationUpdaterFn<T>,
    updateQueries: MutationQueryReducersMap<T>,
    refetchQueries: ((result: ExecutionResult) => RefetchQueryDescription) | RefetchQueryDescription,
    observer: Observer<T>,
};

const enqueueMutation = <T>(operation: Operation, theStore: Store<OfflineCache>, observer: Observer<T>): object => {
    const { query: mutation, variables } = operation;
    const {
        AASContext: {
            optimisticResponse: origOptimistic,
            update,
            updateQueries,
            refetchQueries,
        }
    } = operation.getContext();

    const optimisticResponse = typeof origOptimistic === 'function' ? origOptimistic(variables) : origOptimistic;

    // setTimeout(() => {
    theStore.dispatch({
        type: actions.ENQUEUE,
        payload: { optimisticResponse },
        meta: {
            offline: {
                effect: {
                    optimisticResponse,
                    operation,
                    update,
                    updateQueries,
                    refetchQueries,
                    observer,
                } as EnqueuedMutationEffect<any>,
                commit: { type: actions.COMMIT },
                rollback: { type: actions.ROLLBACK },
            }
        }
    });
    // }, 0);

    let result;

    if (optimisticResponse) {
        result = optimisticResponse;
    } else {
        const mutationDefinition = getMutationDefinition(mutation);

        result = mutationDefinition.selectionSet.selections.reduce((acc, elem: FieldNode) => {
            acc[resultKeyNameFromField(elem)] = null

            return acc;
        }, {});
    }

    return result;
}

interface CanBeSilenced<TCache> extends ApolloCache<TCache> {
    silenceBroadcast?: boolean
};

export const offlineEffect = async <TCache>(
    store: Store<OfflineCache>,
    client: AWSAppSyncClient<TCache>,
    effect: EnqueuedMutationEffect<any>,
    action: OfflineAction
): Promise<FetchResult<Record<string, any>, Record<string, any>>> => {
    const doIt = true;
    const { cache }: { cache: CanBeSilenced<TCache> } = client;
    const {
        optimisticResponse: origOptimistic,
        operation: { variables: origVars, query: mutation },
        update,
        updateQueries,
        refetchQueries,
        observer,
    } = effect;

    await client.hydrated();

    const { [METADATA_KEY]: { idsMap } } = store.getState();
    debugger;
    const variables = replaceUsingMap({ ...origVars }, idsMap);
    const optimisticResponse = replaceUsingMap({ ...origOptimistic }, idsMap);

    return new Promise((resolve, reject) => {
        const buildOperationForLink: Function = Reflect.get(client.queryManager, 'buildOperationForLink');
        const extraContext = {
            AASContext: {
                doIt
            },
            optimisticResponse
        }; // TODO: Populate this
        const operation = buildOperationForLink.call(client.queryManager, mutation, variables, extraContext);

        execute(client.link, operation).subscribe({
            next: data => {
                debugger;
                boundSaveServerId(store, optimisticResponse, data.data);
                // TODO: Update cache

                resolve({ data });

                if (observer.next) {
                    observer.next(data);
                    observer.complete();
                } else {
                    // throw new Error('Manually interact with cache');
                }
            },
            error: err => {
                // TODO: Undo cache updates?

                reject(err);

                if (observer.error) {
                    observer.error(err);
                } else {
                    throw new Error('Manually interact with cache');
                }
            }
        });
    });
}

export const reducer = dataIdFromObject => ({
    [METADATA_KEY]: metadataReducer(dataIdFromObject),
});

const metadataReducer = dataIdFromObject => (state, action) => {
    const { type, payload } = action;

    switch (type) {
        case PERSIST_REHYDRATE:
            const { [METADATA_KEY]: rehydratedState } = payload;

            return rehydratedState || state;
        default:
            const snapshot = snapshotReducer(state && state.snapshot, action);
            const idsMap = idsMapReducer(state && state.idsMap, { ...action, remainingMutations: snapshot.enqueuedMutations }, dataIdFromObject);

            return {
                snapshot,
                idsMap,
            };
    }
};

const snapshotReducer = (state, action) => {
    const enqueuedMutations = enqueuedMutationsReducer(state && state.enqueuedMutations, action);
    const cache = cacheSnapshotReducer(state && state.cache, {
        ...action,
        enqueuedMutations
    });

    return {
        enqueuedMutations,
        cache,
    };
};

const enqueuedMutationsReducer = (state = 0, action) => {
    const { type } = action;

    switch (type) {
        case actions.ENQUEUE:
            return state + 1;
        case actions.COMMIT:
        case actions.ROLLBACK:
            return state - 1;
        default:
            return state;
    }
};

const cacheSnapshotReducer = (state = {}, action) => {
    const { type, payload } = action;

    switch (type) {
        case actions.SAVE_SNAPSHOT:
            const { cache } = payload;
            const cacheContents = { ...cache.extract(false) };

            return cacheContents;
        default:
            return state;
    }
};

const boundSaveServerId = (store, optimisticResponse, data) => store.dispatch(saveServerId(optimisticResponse, data));
const saveServerId = (optimisticResponse, data) => ({
    type: actions.SAVE_SERVER_ID,
    payload: { data, optimisticResponse },
});

const idsMapReducer = (state = {}, action, dataIdFromObject) => {
    const { type, payload = {} } = action;
    const { optimisticResponse } = payload;

    switch (type) {
        case actions.ENQUEUE:
            const ids = getIds(dataIdFromObject, optimisticResponse);
            const entries = Object.values(ids).reduce((acc: { [key: string]: string }, id: string) => (acc[id] = null, acc), {});

            return {
                ...state,
                ...entries,
            };
        case actions.COMMIT:
            const { remainingMutations } = action;

            // Clear ids map on last mutation
            return remainingMutations ? state : {};
        case actions.SAVE_SERVER_ID:
            const { data } = payload;

            const oldIds = getIds(dataIdFromObject, optimisticResponse);
            const newIds = getIds(dataIdFromObject, data);

            const mapped = mapIds(oldIds, newIds);

            return {
                ...state,
                ...mapped,
            };
        default:
            return state;
    }
};

export interface ConflictResolutionInfo {
    mutation: DocumentNode,
    mutationName: string,
    operationType: string,
    variables: object,
    data: object,
    retries: number,
}

export type ConflictResolver = (obj: ConflictResolutionInfo) => 'DISCARD' | boolean;

export const discard = (fn: ConflictResolver = () => 'DISCARD') => (error, action, retries) => {
    const discardResult = _discard(fn, error, action, retries);

    if (discardResult) {
        console.log(action);
        const { } = action;
    }

    return discardResult;
}
const _discard = (fn: ConflictResolver = () => 'DISCARD', error, action, retries) => {
    const { graphQLErrors = [] }: { graphQLErrors: AWSAppsyncGraphQLError[] } = error;
    const conditionalCheck = graphQLErrors.find(err => err.errorType === 'DynamoDB:ConditionalCheckFailedException');

    if (conditionalCheck) {
        if (typeof fn === 'function') {
            const { data } = (conditionalCheck as AWSAppsyncGraphQLError);
            const { meta: { offline: { effect: { mutation, variables } } } } = action;
            const mutationName = getOperationName(mutation);
            const operationDefinition = getOperationDefinition(mutation)
            const { operation: operationType } = operationDefinition;

            try {
                const conflictResolutionResult = fn({
                    mutation,
                    mutationName,
                    operationType,
                    variables,
                    data,
                    retries,
                });

                if (conflictResolutionResult === 'DISCARD') {
                    return true;
                }

                if (conflictResolutionResult) {
                    action.meta.offline.effect.variables = conflictResolutionResult;

                    return false;
                }
            } catch (err) {
                // console.error('Error running conflict resolution. Discarding mutation.', err);

                return true;
            }
        }
    } else if (graphQLErrors.length) {
        // console.error('Discarding action.', action, graphQLErrors);

        return true;
    } else {
        const { networkError: { graphQLErrors = [] } = { graphQLErrors: [] } } = error;
        const appSyncClientError = graphQLErrors.find(err => err.errorType && err.errorType.startsWith('AWSAppSyncClient:'));

        if (appSyncClientError) {
            // console.error('Discarding action.', action, appSyncClientError);

            return true;
        }
    }

    return error.permanent || retries > 10;
};

//#region utils

export const replaceUsingMap = (obj, map = {}) => {
    if (!obj || !map) {
        return obj;
    }

    const newVal = map[obj];
    if (newVal) {
        obj = newVal;

        return obj;
    }

    if (typeof obj === 'object') {
        Object.keys(obj).forEach(key => {
            const val = obj[key];

            if (Array.isArray(val)) {
                obj[key] = val.map((v, i) => replaceUsingMap(v, map));
            } else if (typeof val === 'object') {
                obj[key] = replaceUsingMap(val, map);
            } else {
                const newVal = map[val];
                if (newVal) {
                    obj[key] = newVal;
                }
            }
        });
    }

    return obj;
};

export const getIds = (dataIdFromObject, obj, path = '', acc = {}) => {
    if (!obj) {
        return acc;
    }

    if (typeof obj === 'object') {
        const dataId = dataIdFromObject(obj);

        if (dataId) {
            const [, , id = null] = dataId.match(/(.+:)?(.+)/) || [];

            if (isUuid(dataId)) {
                acc[path] = id;
            }
        }

        Object.keys(obj).forEach(key => {
            const val = obj[key];

            if (Array.isArray(val)) {
                val.forEach((v, i) => getIds(dataIdFromObject, v, `${path}.${key}[${i}]`, acc));
            } else if (typeof val === 'object') {
                getIds(dataIdFromObject, val, `${path}${path && '.'}${key}`, acc);
            }
        });
    }

    return getIds(dataIdFromObject, null, path, acc);
};

const intersectingKeys = (obj1 = {}, obj2 = {}) => {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    return keys1.filter(k => keys2.indexOf(k) !== -1);
};

const mapIds = (obj1, obj2) => intersectingKeys(obj1, obj2).reduce((acc, k) => (acc[obj1[k]] = obj2[k], acc), {});
//#endregion
