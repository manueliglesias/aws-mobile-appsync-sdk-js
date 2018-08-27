import { AWSAppSyncClient, AUTH_TYPE } from "../src/client";
import gql from "graphql-tag";
import { v4 as uuid } from "uuid";
import { Observable } from "apollo-link";
import { createHttpLink } from "apollo-link-http";

jest.mock('apollo-link-http-common', () => ({
    checkFetcher: () => { },
}));

jest.mock('apollo-link-http', () => ({
    createHttpLink: jest.fn(),
}));

const mockHttpResponse = resp => {
    (createHttpLink as jest.Mock).mockImplementation(() => ({
        request: () => Observable.of({ ...resp })
    }));
};

const getClient = () => new AWSAppSyncClient({
    url: 'some url',
    region: 'some region',
    auth: {
        type: AUTH_TYPE.API_KEY,
        apiKey: 'some key'
    },
    // disableOffline: true,
});

describe("offline", () => {

    test("something", async () => {
        const localId = uuid();
        const serverId = uuid();

        const serverResponse = {
            addTodo: {
                __typename: 'Todo',
                id: serverId,
                name: 'MyTodo1'
            }
        };
        const optimisticResponse = {
            addTodo: {
                __typename: 'Todo',
                id: localId,
                name: 'MyTodo1'
            }
        };

        mockHttpResponse({ data: serverResponse });

        const client = getClient();

        const result = await client.mutate({
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

        expect(result).toMatchObject({ data: { ...optimisticResponse } });

        expect((client.cache as any).data.data).toMatchObject({
            [`Todo:${localId}`]: optimisticResponse.addTodo
        });

        await new Promise(r => setTimeout(r, 100));

        expect((client.cache as any).data.data).toMatchObject({
            [`Todo:${serverId}`]: serverResponse.addTodo
        });
    });
});