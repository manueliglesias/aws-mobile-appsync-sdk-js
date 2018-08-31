import gql from "graphql-tag";
import { v4 as uuid } from "uuid";
import { Observable } from "apollo-link";
import { createHttpLink } from "apollo-link-http";
import { AWSAppSyncClientOptions, AWSAppSyncClient, AUTH_TYPE } from "../src/client";
import { Store } from "redux";
import { OfflineCache } from "../src/cache/offline-cache";

jest.mock('apollo-link-http-common', () => ({
    checkFetcher: () => { },
}));

jest.mock('apollo-link-http', () => ({
    createHttpLink: jest.fn(),
}));

let setNetworkOnlineStatus: (online: boolean) => void;
jest.mock("@redux-offline/redux-offline/lib/defaults/detectNetwork", () => (callback) => {
    setNetworkOnlineStatus = online => {
        setTimeout(() => callback({ online }), 0);
    };

    // Setting initial network online status
    callback({ online: true });
});

const getStoreState = <T>(client: AWSAppSyncClient<T>) => ((client as any)._store as Store<OfflineCache>).getState();

const isNetworkOnline = <T>(client: AWSAppSyncClient<T>) => getStoreState(client).offline.online;

const getOutbox = <T>(client: AWSAppSyncClient<T>) => getStoreState(client).offline.outbox;

const mockHttpResponse = (resp, delay = 0) => {
    (createHttpLink as jest.Mock).mockImplementationOnce(() => ({
        request: () => new Observable(observer => {
            const timer = setTimeout(() => {
                observer.next({ ...resp });
                observer.complete();
            }, delay);

            // On unsubscription, cancel the timer
            return () => clearTimeout(timer);
        })
    }));
};

const getClient = (options?: Partial<AWSAppSyncClientOptions>) => {
    const defaultOptions = {
        url: 'some url',
        region: 'some region',
        auth: {
            type: AUTH_TYPE.API_KEY,
            apiKey: 'some key'
        },
        disableOffline: false,
    };

    const client = new AWSAppSyncClient({
        ...defaultOptions,
        ...options
    });

    return client;
};

const backendError = {
    path: ["addTodo"],
    data: null,
    errorType: "DynamoDB:AmazonDynamoDBException",
    errorInfo: null,
    locations: [{ line: 2, column: 3, sourceName: null }],
    message: "One or more parameter values were invalid: An AttributeValue may not contain an empty string (Service: AmazonDynamoDBv2; Status Code: 400; Error Code: ValidationException; Request ID: LHUURAGKQKF1PC87B7S3UFSCHVVV4KQNSO5AEMVJF66Q9ASUAAJG)"
};
const graphqlError = {
    graphQLErrors: [{ ...backendError }],
    networkError: null,
    message: `GraphQL error: ${backendError.message}`
};

describe("Offline disabled", () => {

    test("it updates the cache with server response", async () => {
        const localId = uuid();
        const serverId = uuid();

        const optimisticResponse = {
            addTodo: {
                __typename: 'Todo',
                id: localId,
                name: 'MyTodo1'
            }
        };
        const serverResponse = {
            addTodo: {
                __typename: 'Todo',
                id: serverId,
                name: 'MyTodo1'
            }
        };

        mockHttpResponse({ data: serverResponse });

        const client = getClient({ disableOffline: true });

        const resultPromise = client.mutate({
            mutation: gql`mutation($name: String!) {
                addTodo(
                    name: $name
                ) {
                    id,
                    name
                }
            }`,
            variables: {
                name: 'MyTodo1'
            },
            optimisticResponse
        });

        // The optimistic response is present in the cache
        expect(client.cache.extract(true)).toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });

        const result = await resultPromise;

        expect(result).toMatchObject({ data: { ...serverResponse } });

        // The server response is present in the cache
        expect(client.cache.extract(false)).toMatchObject({
            [`Todo:${serverId}`]: serverResponse.addTodo
        });
    });

    test("error handling", async () => {
        const localId = uuid();

        const optimisticResponse = {
            addTodo: {
                __typename: 'Todo',
                id: localId,
                name: 'MyTodo1'
            }
        };

        mockHttpResponse({
            data: { addTodo: null },
            errors: [backendError]
        });

        const client = getClient({ disableOffline: true });

        const resultPromise = client.mutate({
            mutation: gql`mutation($name: String!) {
                addTodo(
                    name: $name
                ) {
                    id,
                    name
                }
            }`,
            variables: {
                name: 'MyTodo1'
            },
            optimisticResponse
        });

        // The optimistic response is present in the cache
        expect(client.cache.extract(true)).toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });

        try {
            await resultPromise;

            fail("Error wasn't thrown");
        } catch (error) {
            expect(error).toMatchObject(graphqlError);
        }

        // The optimistic response is no longer present in the cache
        expect(client.cache.extract(true)).toEqual({});
        expect(client.cache.extract(false)).toEqual({});
    });
});

describe("Offline enabled", () => {

    test("it updates the cache with server response", async () => {
        const localId = uuid();
        const serverId = uuid();

        const optimisticResponse = {
            addTodo: {
                __typename: 'Todo',
                id: localId,
                name: 'MyTodo1'
            }
        };
        const serverResponse = {
            addTodo: {
                __typename: 'Todo',
                id: serverId,
                name: 'MyTodo1'
            }
        };

        mockHttpResponse({ data: serverResponse });

        const client = getClient({ disableOffline: false });

        const resultPromise = client.mutate({
            mutation: gql`mutation($name: String!) {
                addTodo(
                    name: $name
                ) {
                    id,
                    name
                }
            }`,
            variables: {
                name: 'MyTodo1'
            },
            optimisticResponse
        });

        // The optimistic response is present in the cache
        expect(client.cache.extract(true)).toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });

        // // Give it some time
        // await new Promise(r => setTimeout(r, 200));
        // // asert queue
        // const { offline: { outbox } } = ((client as any)._store as Store<any>).getState();
        // expect(((client as any)._store as Store<any>).getState()).not.toBeTruthy();
        // expect((outbox as any[]).length).toBe(1);

        const result = await resultPromise;

        // Give it some time
        await new Promise(r => setTimeout(r, 100));

        expect(result).toMatchObject({ data: { ...serverResponse } });

        // The server response is present in the cache
        expect(client.cache.extract(false)).toMatchObject({
            [`Todo:${serverId}`]: serverResponse.addTodo
        });
    });

    test("it updates the cache with optimistic response response (offline)", async () => {
        const localId = uuid();
        const serverId = uuid();

        const optimisticResponse = {
            addTodo: {
                __typename: 'Todo',
                id: localId,
                name: 'MyTodo1'
            }
        };
        const serverResponse = {
            addTodo: {
                __typename: 'Todo',
                id: serverId,
                name: 'MyTodo1'
            }
        };

        mockHttpResponse({ data: serverResponse });

        const client = getClient({ disableOffline: false });

        setNetworkOnlineStatus(false);

        const resultPromise = client.mutate({
            mutation: gql`mutation($name: String!) {
                addTodo(
                    name: $name
                ) {
                    id,
                    name
                }
            }`,
            variables: {
                name: 'MyTodo1'
            },
            optimisticResponse
        });

        // The optimistic response is present in the cache
        expect(client.cache.extract(true)).toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });

        const result = await resultPromise;

        // Give it some time
        await new Promise(r => setTimeout(r, 100));

        expect(result).toMatchObject({ data: { ...optimisticResponse } });

        // The optimistic response is present in the cache
        expect(client.cache.extract(false)).toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });
    });

    test("error handling (online)", async () => {
        const localId = uuid();

        const optimisticResponse = {
            addTodo: {
                __typename: 'Todo',
                id: localId,
                name: 'MyTodo1'
            }
        };

        mockHttpResponse({
            data: { addTodo: null },
            errors: [backendError]
        });

        const client = getClient({ disableOffline: false });

        const resultPromise = client.mutate({
            mutation: gql`mutation($name: String!) {
                addTodo(
                    name: $name
                ) {
                    id,
                    name
                }
            }`,
            variables: {
                name: 'MyTodo1'
            },
            optimisticResponse
        });

        // The optimistic response is present in the cache
        expect(client.cache.extract(true)).toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });

        try {
            await resultPromise;

            fail("Error wasn't thrown");
        } catch (error) {
            expect(error).toMatchObject(graphqlError);
        }

        // The optimistic response is no longer present in the cache
        expect(client.cache.extract(true)).not.toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });
    });

    test.only("it updates ids of dependent mutations", async () => {
        const localId = uuid();
        const serverId = uuid();
        const localIdChild = uuid();
        const serverIdChild = uuid();

        const optimisticResponseParent = {
            addParent: {
                __typename: 'Parent',
                id: localId,
                name: 'Parent'
            }
        };
        const serverResponseParent = {
            addParent: {
                __typename: 'Parent',
                id: serverId,
                name: 'Parent'
            }
        };

        const optimisticResponseChild = {
            addChild: {
                __typename: 'Child',
                id: localIdChild,
                name: 'Child'
            }
        };
        const serverResponseChild = {
            addChild: {
                __typename: 'Child',
                id: serverIdChild,
                name: 'Child'
            }
        };

        mockHttpResponse({ data: serverResponseParent });
        mockHttpResponse({ data: serverResponseChild });

        const client = getClient({ disableOffline: false });
        await client.hydrated();

        setNetworkOnlineStatus(false);
        await new Promise(r => setTimeout(r, 100));

        const parent = await client.mutate({
            mutation: gql`mutation($name: String!) {
                addParent(
                    name: $name
                ) {
                    id,
                    name
                }
            }`,
            variables: {
                name: 'Parent'
            },
            optimisticResponse: optimisticResponseParent,
        });
        expect(parent.data).toMatchObject(optimisticResponseParent);

        const child = await client.mutate({
            mutation: gql`mutation($parentId: ID, $name: String!) {
                addChild(
                    parentId: $parentId
                    name: $name
                ) {
                    id,
                    name
                }
            }`,
            variables: {
                parentId: localId,
                name: 'Child'
            },
            optimisticResponse: optimisticResponseChild
        });
        expect(child.data).toMatchObject(optimisticResponseChild);

        // The optimistic response is present in the cache
        expect(client.cache.extract(false)).toMatchObject({
            [`Parent:${localId}`]: optimisticResponseParent.addParent,
            [`Child:${localIdChild}`]: optimisticResponseChild.addChild
        });

        // wait fo rthe to show in outbox
        await new Promise(r => setTimeout(r, 100));

        // asert queue
        expect(getOutbox(client).length).toBe(2);

        setNetworkOnlineStatus(true);
        await new Promise(r => setTimeout(r, 100));

        // Wait for queue to drain?
        await new Promise(r => setTimeout(r, 100));

        // asert queue
        expect(getOutbox(client).length).toBe(0);

        // The optimistic response is present in the cache
        // expect(client.cache.extract(false)).not.toMatchObject({
        //     [`Parent:${localId}`]: optimisticResponseParent.addParent,
        //     [`Child:${localIdChild}`]: optimisticResponseChild.addChild
        // });

        // const result = await resultPromise;

        // // Give it some time
        // await new Promise(r => setTimeout(r, 100));

        // expect(result).toMatchObject({ data: { ...serverResponseParent } });

        // The server response is present in the cache
        // expect(client.cache.extract(false)).toMatchObject({
        //     [`Parent:${serverId}`]: serverResponseParent.addParent,
        //     [`Child:${serverIdChild}`]: serverResponseChild.addChild,
        // });
    }, 6000);
});