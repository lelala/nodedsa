# nodedsa
Sample
----
```
var conn = require('nodedsa').open(url, accesstoken);
// accesstoken can be securityToken object ex: {"@": ["Type"],"Type": "Passport","DSAPassport": {...}}
conn.send({
	service:'',
	body:{},
	result:function(resp){
	
	}
});

var resp = await conn.send({
	service:'',
	body:{}
});

// Optional Fetch-compatible request options can carry trace headers.
var request = {
	service:'UDTService.DML.Query',
	body:{ Request: { SQL: 'select 1' } }
};
var options = {
	headers:{
		traceparent:'00-<trace-id>-<span-id>-01',
		'X-Cloud-Trace-Context':'<trace-id>/<span-id>;o=1'
	},
	redirect:'follow'
};
var respWithTrace = await conn.send(request, options);
```

`options` follows the runtime Fetch `RequestInit` shape. `headers` accepts a
`Headers` instance, header-pair sequence, or string record. Caller headers
replace same-name defaults case-insensitively; the library continues to own the
HTTP `POST` method and serialized DSA XML body. Neither argument is mutated.

License
----

MIT

Version
----
2.1.0

OpenSpec development workflow
----

This repository uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for
spec-driven changes. The current product behavior is recorded under
`openspec/specs/`, and proposed work lives under `openspec/changes/` until it is
implemented and archived.

Install dependencies and verify the specification baseline:

```sh
npm install
npm run spec:list
npm run spec:validate
```

For Codex, restart the app after cloning or after the first setup so the
project-local OpenSpec skills in `.codex/skills/` are discovered. The normal
change lifecycle is:

1. Explore the problem with the `$openspec-explore` skill when the scope is
   unclear.
2. Create a proposal with the `$openspec-propose` skill.
3. Review the generated proposal, delta specs, design, and tasks in
   `openspec/changes/<change-name>/`.
4. Implement the approved work with the `$openspec-apply-change` skill.
5. Run the relevant code tests and `npm run spec:validate`.
6. Archive the completed change with the `$openspec-archive-change` skill;
   this merges its delta specs into the baseline.

Use short, kebab-case change names such as `add-request-timeout`. Do not edit
the baseline specs for proposed behavior before the corresponding change is
approved and archived.

