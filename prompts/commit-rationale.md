# Task summary
You are an experienced Java programmer on the $project_name project. Your task is to generate concise and accurate **rationale components** that explain why a specific code change was made.

You will be provided with:
-  A list of the **rationale component types**, each with a short description.
- A **code diff** showing how one or more files were modified in a commit.
- A set of **annotated sentences** related to the commit. These sentences are labeled with one of the rationale components and are extracted from various software artifacts (e.g., commit messages, pull requests, issue reports, code reviews, Javadocs, inline comments).

# Rationale Component Types with Descriptions
- **GOAL**: Describes what changes have been made by the developer in the code change. This is a high-level or low-level description of the code change, indicating what the developer aims to achieve with the code change.
- **NEED**: Describes the specific reason, motivation, or benefit of the code change. This indicates why the developer wants to make the code change.
- **ALTERNATIVES**: Describes other potential solutions considered by the developers before making the final code change. This indicates the alternative solutions discussed by the developers, but not implemented for the code change.

# Instructions
1. **Analyze the code diff** to understand the technical nature of the code change.  
2. **Review the annotated sentences** to find relevant information about the rationale behind the change.  
3. **For each rationale component**:
   - Identify sentences labeled with that component and **discard irrelevant or redundant ones**. 
   - **Group logically consecutive sentences** (i.e., those sharing the same `CommitID_SourceID_TextID`) as contextual units. Use this structure to understand the full meaning of the text.   
   - Connect sentences with the same label from different artifacts for each component.
   - **Synthesize a brief, clear rationale summary** for the component using only the information in the relevant labeled sentences and the code diff.  
   - **Use wording close to the original** when possible, but rewrite or combine sentences as needed for clarity.

## Important Notes  
- **Do not infer or assume anything** that is not explicitly stated or clearly implied in the code diff or annotated sentences.  
- Sentence IDs follow the format `CommitID_SourceID_TextID_LocalSentenceID`. Use the `CommitID_SourceID_TextID` prefix to identify groups of related sentences that form a logical unit.
- If a rationale component is not present or cannot be inferred from the inputs, **omit that component** from the response.

# Inputs

## Diff of the Target Commit
$code_diff_information

## Annotated Sentences from Artifacts
$sentences_information

# Response Format
Return only the rationale component summaries in the following format:  
GOAL: <brief_description>
NEED: <brief_description>
ALTERNATIVES: <brief_description>

# Examples for Illustration Purposes
Below, I am providing 2 example commits with the code diff, sentences for that commit with the rationale component labels, and the human-written rationale component descriptions. Use the examples only for learning purposes.

## Example-1
### Diff of the Example-1 Commit
1. 
File: src/main/java/org/junit/rules/ExpectedException.java
Patch:
"""@@ -43,8 +43,8 @@
  *         public void throwsIllegalArgumentExceptionWithMessageAndCause() {
  *             NullPointerException expectedCause = new NullPointerException();
  *                 thrown.expect(IllegalArgumentException.class);
- *                 thrown.expectMessage(&quot;happened?&quot;);
- *             thrown.expectCause(expectedCause);
+ *                 thrown.expectMessage(&quot;What&quot;);
+ *                 thrown.expectCause(is(expectedCause));
  *                 throw new IllegalArgumentException(&quot;What happened?&quot;, cause);
  *         }
  * }
@@ -106,8 +106,12 @@ public void expectMessage(Matcher<String> matcher) {
                 expect(hasMessage(matcher));
         }
 
-    public void expectCause(Throwable expectedCause) {
-        expect(causeEquals(expectedCause));
+    /**
+     * Adds {@code matcher} to the list of requirements for the cause of
+     * any thrown exception.
+     */
+    public void expectCause(Matcher<? extends Throwable> expectedCause) {
+        expect(hasCause(expectedCause));
     }
 
     private class ExpectedExceptionStatement extends Statement {
@@ -147,16 +151,16 @@ public boolean matchesSafely(Throwable item) {
                 };
         }
 
-    private Matcher<Throwable> causeEquals(final Throwable expectedCause) {
+    private Matcher<Throwable> hasCause(final Matcher<? extends Throwable> causeMatcher) {
         return new TypeSafeMatcher<Throwable>() {
-            @Override
-            public boolean matchesSafely(Throwable item) {
-                return expectedCause == null ? item.getCause() == null : expectedCause.equals(item.getCause());
-            }
-
             public void describeTo(Description description) {
                 description.appendText("exception with cause ");
-                description.appendText(expectedCause.toString());
+                description.appendDescriptionOf(causeMatcher);
+            }
+
+            @Override
+            public boolean matchesSafely(Throwable item) {
+                return causeMatcher.matches(item.getCause());
             }
         };
     }"""

2. 
File: src/test/java/org/junit/tests/experimental/rules/ExpectedExceptionRuleTest.java
Patch:
"""@@ -1,18 +1,21 @@
 package org.junit.tests.experimental.rules;
 
-import static org.hamcrest.CoreMatchers.any;
-import static org.junit.Assert.assertThat;
-import static org.junit.experimental.results.PrintableResult.testResult;
-import static org.junit.experimental.results.ResultMatchers.hasSingleFailureContaining;
-import static org.junit.experimental.results.ResultMatchers.isSuccessful;
-import static org.junit.matchers.JUnitMatchers.both;
+import org.hamcrest.CoreMatchers;
 import org.hamcrest.Description;
 import org.hamcrest.Matcher;
 import org.junit.Rule;
 import org.junit.Test;
 import org.junit.internal.matchers.TypeSafeMatcher;
 import org.junit.rules.ExpectedException;
 
+import static org.hamcrest.CoreMatchers.any;
+import static org.hamcrest.CoreMatchers.is;
+import static org.junit.Assert.assertThat;
+import static org.junit.experimental.results.PrintableResult.testResult;
+import static org.junit.experimental.results.ResultMatchers.hasSingleFailureContaining;
+import static org.junit.experimental.results.ResultMatchers.isSuccessful;
+import static org.junit.matchers.JUnitMatchers.both;
+
 public class ExpectedExceptionRuleTest {
         public static class HasExpectedException {
                 @Rule
@@ -42,7 +45,7 @@ public void throwsIllegalArgumentExceptionWithCause() {
 
             thrown.expect(IllegalArgumentException.class);
             thrown.expectMessage("Ack!");
-            thrown.expectCause(expectedCause);
+            thrown.expectCause(is(expectedCause));
 
             throw new IllegalArgumentException("Ack!", expectedCause);
         }
@@ -51,7 +54,7 @@ public void throwsIllegalArgumentExceptionWithCause() {
         public void throwsIllegalArgumentExceptionWithCauseExplicitlyNull() {
             thrown.expect(IllegalArgumentException.class);
             thrown.expectMessage("Ack!");
-            thrown.expectCause(null);
+            thrown.expectCause(CoreMatchers.<Throwable>nullValue());
 
             throw new IllegalArgumentException("Ack!");
         }
@@ -260,7 +263,7 @@ public static class HasWrongCause {
                 public void throwWithCause() {
             thrown.expect(IllegalArgumentException.class);
                         thrown.expectMessage("Ack!");
-            thrown.expectCause(EXPECTED_CAUSE);
+            thrown.expectCause(is(EXPECTED_CAUSE));
 
                         throw new IllegalArgumentException("Ack!", new NullPointerException("an unexpected cause"));
                 }""" 

### Sentences of the Example-1 Commit (Separated by Source)

The sentences we have already labeled are shown with their corresponding labels. Only those sentences are mentioned here which have rationale information.

The following sentences come from the commit message:

Id: 756_1_1_0
Source: COMMIT_MESSAGE
Sentence: 
"""changed the expectedCause() method to accept a Matcher instead of an explicit Throwable and made some documentation changes"""
Label: GOAL, NEED

The following sentences come from the Javadoc comments of the method(src/main/java/org/junit/rules/ExpectedException.java#expectCause) that were changed

Id: 756_4_6_0
Source: METHOD_JAVADOCS
Sentence: 
"""Adds {@code matcher} to the list of requirements for the message returned from any thrown exception."""
Label: GOAL

The following sentences come from the comments on the changed code. The sentences have [ADD] and [REM] prefixes. The sentences with [ADD] mean these sentences are added in the code commit, and sentences with [REM] mean these sentences are removed in the code commit:

Id: 756_2_3_0
Source: CODE_COMMENT
Sentence: 
"""[ADD]: Adds {@code matcher} to the list of requirements for the cause of any thrown exception. /"""
Label: GOAL

The following sentences come from the pull_request: https://github.com/junit-team/junit4/pull/377, associated with the commit

Id: 756_8_7_0
Source: PULL_REQUEST
Sentence: 
"""Enable ExpectedException to match causes more easily"""
Label: GOAL, NEED

Id: 756_8_8_0
Source: PULL_REQUEST
Sentence: 
"""When working especially with third-party libraries, it's common to deal with checked exceptions in a way similar to this:

``` java
  try {
     collaborator.something();
  }
  catch (CheckedException e) {
     throw new MyRuntimeException("failed to do something", e);
  }
```

It's common for different instances of MyRuntimeException to be thrown from many possible execution branches, so when testing this, I would like to do something like:

``` java
  @Rule
  ExpectedException thrown= ExpectedException.none();

  @Test
  public void aTest() throws Exception {
    CheckedException expected = new CheckedException("expected");

    Mockito.when(collaborator.something()).thenThrow(expected);

    thrown.expect(MyRuntimeException.class);
    thrown.expectMessage("failed to do something");
    thrown.expectCause(expected);

    myObject.method();
  }"""
Label: NEED

Id: 756_8_8_4
Source: PULL_REQUEST
Sentence: 
"""I realise you can do that with a custom matcher as well, but it feels like this is (at least nearly) as fundamental as matching on the message, so it should perhaps be a part of the core framework?"""
Label: NEED, ALTERNATIVES

Id: 756_8_9_2
Source: PULL_REQUEST
Sentence: 
"""What about one of these ideas:

thrown.expectCause(instanceOf(CheckedException.class));

Or, trickier:

thrown.onCause().expectMessage("failed to do something"), where onCause() returns an ExpectedException itself (haven't thought about how hard this would be)."""
Label: ALTERNATIVES

Id: 756_8_11_1
Source: PULL_REQUEST
Sentence: 
"""I still think that having expectCause take a Matcher means more flexibility for everyone."""
Label: NEED

Id: 756_8_11_2
Source: PULL_REQUEST
Sentence: 
"""Developers can use thrown.expectCause(is(expected)) when they want the exact exception, and other matchers when they want something more generic."""
Label: NEED

### Human-written Rationale Components for the Example-1 Commit
GOAL: Improve ExpectedException by allowing its expectedCause() method to match causes easily using a Matcher instead of an explicit Throwable.
NEED: The existing expectCause() method uses Throwable that forces every test to supply a concrete exception. The method should be able to match the exception’s cause easily without relying on the exact Throwable instance. This would enable ExpectedException to match causes more easily and provide flexibility for developers.
ALTERNATIVES: Developers could have used a custom matcher, the existing instanceOf() function, the onCause() method returning an ExpectedException itself, or a statically importable method like causeOfType() for matching the causes.


## Example-2

### Diff of the Example-2 Commit
1. 
File: dubbo-rpc/dubbo-rpc-api/src/main/java/org/apache/dubbo/rpc/protocol/AsyncToSyncInvoker.java
Diff:
"""@@ -61,13 +61,19 @@ public Result invoke(Invocation invocation) throws RpcException {
                 asyncResult.get(Integer.MAX_VALUE, TimeUnit.MILLISECONDS);
             }
         } catch (InterruptedException e) {
-            throw new RpcException("Interrupted unexpectedly while waiting for remoting result to return!  method: " + invocation.getMethodName() + ", provider: " + getUrl() + ", cause: " + e.getMessage(), e);
+            throw new RpcException("Interrupted unexpectedly while waiting for remote result to return!  method: " +
+                    invocation.getMethodName() + ", provider: " + getUrl() + ", cause: " + e.getMessage(), e);
         } catch (ExecutionException e) {
             Throwable t = e.getCause();
             if (t instanceof TimeoutException) {
-                throw new RpcException(RpcException.TIMEOUT_EXCEPTION, "Invoke remote method timeout. method: " + invocation.getMethodName() + ", provider: " + getUrl() + ", cause: " + e.getMessage(), e);
+                throw new RpcException(RpcException.TIMEOUT_EXCEPTION, "Invoke remote method timeout. method: " +
+                        invocation.getMethodName() + ", provider: " + getUrl() + ", cause: " + e.getMessage(), e);
             } else if (t instanceof RemotingException) {
-                throw new RpcException(RpcException.NETWORK_EXCEPTION, "Failed to invoke remote method: " + invocation.getMethodName() + ", provider: " + getUrl() + ", cause: " + e.getMessage(), e);
+                throw new RpcException(RpcException.NETWORK_EXCEPTION, "Failed to invoke remote method: " +
+                        invocation.getMethodName() + ", provider: " + getUrl() + ", cause: " + e.getMessage(), e);
+            } else {
+                throw new RpcException(RpcException.UNKNOWN_EXCEPTION, "Fail to invoke remote method: " +
+                        invocation.getMethodName() + ", provider: " + getUrl() + ", cause: " + e.getMessage(), e);
             }
         } catch (Throwable e) {
             throw new RpcException(e.getMessage(), e);"""

## Sentences of the Example Commit 2 (Separated by Source).

The sentences we have already labeled are shown with their corresponding labels. Only those sentences are mentioned here which have rationale information.

The following sentences come from the commit message

Id: 2653_1_1_0
Source: COMMIT_MESSAGE
Sentence:
"""throw unknown exception (#5849)"""
Label: GOAL

The following sentences come from the pull request: https://github.com/apache/dubbo/pull/5849, associated with the commit

Id: 2653_6_4_0
Source: PULL_REQUEST
Sentence:
"""In `AsyncToSyncInvoker`, when `ExecutionException` happens, only `TimeoutException` and `RemotingException` are handled and wrapped as `RpcException` and re-throw."""
Label: NEED

Id: 2653_6_4_1
Source: PULL_REQUEST
Sentence:
"""The problem here is other exception will be swallowed silently."""
Label: NEED

Id: 2653_6_4_3
Source: PULL_REQUEST
Sentence:
""""wrap other exception in `RpcException` and rethrow."""
Label: GOAL

### Human-written Rationale Components for the Example-2 Commit
GOAL: Improve exception handling to handle unknown exceptions in AsyncToSyncInvoker.
NEED: Only TimeoutException and RemotingException were handled in AsyncToSyncInvoker. This commit prevents all other unhandled exceptions from being ignored, which can cause silent failure.

# Source citations

End every sentence of GOAL, NEED, and ALTERNATIVES with its own citation markers. Do not group citations at the end of a paragraph.

$citation_instructions
