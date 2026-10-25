// Example LucydDeck plugin: one command that logs, one that throws.
// Install the folder from the Plugins view, then run a key with the step
// `CMD:hello:greet`.

export async function setup(context) {
    context.registerCommand("greet", {
        title: "Say hello",
        handler: async () => {
            const { greeting } = context.getConfig();
            context.log("info", `${greeting} from the hello plugin`);
        },
    });

    context.registerCommand("fail", {
        title: "Throw an error",
        handler: async () => {
            throw new Error("The hello plugin failed on purpose");
        },
    });
}

export async function teardown() {
    // Nothing is held open by this example.
}
