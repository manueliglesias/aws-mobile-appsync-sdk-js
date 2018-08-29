import gql from "graphql-tag";
import { v4 as uuid } from "uuid";
import { Observable } from "apollo-link";
import { createHttpLink } from "apollo-link-http";
import { AWSAppSyncClientOptions, AWSAppSyncClient, AUTH_TYPE } from "../src/client";

jest.mock('apollo-link-http-common', () => ({
    checkFetcher: () => { },
}));

jest.mock('apollo-link-http', () => ({
    createHttpLink: jest.fn(),
}));

let setNetworkOnlineStatus: (online: boolean) => void;
jest.mock("@redux-offline/redux-offline/lib/defaults/detectNetwork", () => (callback) => {
    setNetworkOnlineStatus = online => callback({ online });

    return callback({
        online: true
    });
});

const mockHttpResponse = resp => {
    (createHttpLink as jest.Mock).mockImplementation(() => ({
        request: () => Observable.of({ ...resp })
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

    return new AWSAppSyncClient({
        ...defaultOptions,
        ...options
    });
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
        // expect(client.cache.extract(true)).toEqual({});
        // expect(client.cache.extract(false)).toEqual({});

        // Give it some time
        await new Promise(r => setTimeout(r, 100));
    });
});